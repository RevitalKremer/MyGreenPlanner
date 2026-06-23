"""Electrical string-plan engine (Tier 2 / B2B+).

Pure, self-contained calculations for the electrical design module:

  * inverter auto-sizing from total DC power (DC:AC ratio target)
  * per-area string auto-generation (strings never cross areas)
  * validation of a string plan against inverter MPPT limits

Everything here is a pure function over plain dicts (panels, products,
settings) so it is trivially unit-testable and reusable from the router. The
functions are tolerant of MISSING electrical specs: rather than raising, they
surface structured `{code, severity, field, params}` issues — panel electrical
blobs and inverter MPPT specs are admin-maintained and may be incomplete.

Voltage temperature correction:
  Voc(T) = Voc_stc * (1 + tempCoeffVoc%/100 * (T - 25))      # cold T -> max Voc
  Vmp(T) = Vmp_stc * (1 + tempCoeffVmp%/100 * (T - 25))      # hot T  -> min Vmp
"""
from __future__ import annotations

import json
import math
from typing import Any

from app.utils.panel_geometry import REAL_PANELS  # noqa: F401  (kept for parity/use)

# ── Defaults (Israel) ───────────────────────────────────────────────────────
STC_TEMP_C = 25.0
# Cold ambient design temp → worst-case (highest) Voc. Hot cell design temp →
# worst-case (lowest) Vmp. Editable in Step 6 settings; these are the defaults.
DEFAULT_DESIGN_TEMP_MIN_C = -5.0
DEFAULT_DESIGN_TEMP_MAX_CELL_C = 70.0
# Typical module temp coefficients (%/°C) used only when a panel's electrical
# blob omits them. Both negative.
FALLBACK_TEMP_COEFF_VOC = -0.27
FALLBACK_TEMP_COEFF_VMP = -0.35
# NEC-style continuous-current safety factor for per-MPPT input current.
CURRENT_SAFETY_FACTOR = 1.25
# DC:AC oversizing window for inverter auto-sizing.
DCAC_MIN, DCAC_MAX, DCAC_TARGET = 1.1, 1.3, 1.2

SEV_ERROR = 'error'
SEV_WARNING = 'warning'


def _issue(code: str, severity: str, field: str, **params) -> dict:
    return {'code': code, 'severity': severity, 'field': field, 'params': params}


# ── Spec extraction (tolerant) ───────────────────────────────────────────────

def _num(d: dict | None, *keys) -> float | None:
    """First present numeric value among keys in dict d, else None."""
    if not d:
        return None
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def panel_specs(panel_product: Any) -> dict:
    """Extract panel electrical specs from a Product (ORM obj or dict).

    Returns a dict with Voc/Vmp/Isc/Imp/tempCoeffVoc/tempCoeffVmp/wp and a
    `missing` list naming any spec that had to fall back / is absent.
    """
    elec = getattr(panel_product, 'params', None) if panel_product is not None else None
    if elec is None and isinstance(panel_product, dict):
        elec = panel_product.get('params')
    elec = elec or {}

    kw_peak = getattr(panel_product, 'kw_peak', None)
    if kw_peak is None and isinstance(panel_product, dict):
        kw_peak = panel_product.get('kw_peak')

    missing = []
    voc = _num(elec, 'Voc', 'voc')
    vmp = _num(elec, 'Vmp', 'vmp')
    isc = _num(elec, 'Isc', 'isc')
    imp = _num(elec, 'Imp', 'imp')
    for name, val in (('Voc', voc), ('Vmp', vmp), ('Isc', isc), ('Imp', imp)):
        if val is None:
            missing.append(name)

    coeff_voc = _num(elec, 'tempCoeffVocPctPerC', 'tempCoeffVoc')
    coeff_vmp = _num(elec, 'tempCoeffVmpPctPerC', 'tempCoeffVmp')
    # Wp: explicit electrical.Wp, else kw_peak (catalog stores panel watts there).
    wp = _num(elec, 'Wp', 'wp')
    if wp is None and isinstance(kw_peak, (int, float)):
        wp = float(kw_peak)

    return {
        'Voc': voc, 'Vmp': vmp, 'Isc': isc, 'Imp': imp,
        'tempCoeffVoc': coeff_voc if coeff_voc is not None else FALLBACK_TEMP_COEFF_VOC,
        'tempCoeffVmp': coeff_vmp if coeff_vmp is not None else FALLBACK_TEMP_COEFF_VMP,
        'wp': wp,
        'missing': missing,
    }


def inverter_specs(inverter_product: Any) -> dict:
    """Extract inverter MPPT specs from a Product (ORM obj or dict)."""
    elec = getattr(inverter_product, 'params', None) if inverter_product is not None else None
    if elec is None and isinstance(inverter_product, dict):
        elec = inverter_product.get('params')
    elec = elec or {}

    ac_kw = _num(elec, 'acPowerKw')
    ac_w = _num(elec, 'acPowerW')
    if ac_w is None and ac_kw is not None:
        ac_w = ac_kw * 1000.0

    missing = []
    mppt_vmin = _num(elec, 'mpptVmin')
    mppt_vmax = _num(elec, 'mpptVmax')
    max_input_current = _num(elec, 'maxInputCurrentA')
    for name, val in (('mpptVmin', mppt_vmin), ('mpptVmax', mppt_vmax),
                      ('maxInputCurrentA', max_input_current)):
        if val is None:
            missing.append(name)

    return {
        'acPowerW': ac_w,
        'maxDcPowerW': _num(elec, 'maxDcPowerW'),
        'mpptCount': int(_num(elec, 'mpptCount') or 1),
        'mpptVmin': mppt_vmin,
        'mpptVmax': mppt_vmax,
        'maxInputCurrentA': max_input_current,
        'maxStringsPerMppt': int(_num(elec, 'maxStringsPerMppt') or 1),
        'maxSystemVoltageV': _num(elec, 'maxSystemVoltageV'),
        'missing': missing,
    }


def _voc_at(voc_stc: float, coeff_pct: float, temp_c: float) -> float:
    return voc_stc * (1 + coeff_pct / 100.0 * (temp_c - STC_TEMP_C))


def _vmp_at(vmp_stc: float, coeff_pct: float, temp_c: float) -> float:
    return vmp_stc * (1 + coeff_pct / 100.0 * (temp_c - STC_TEMP_C))


# ── Recommended inverter capacity ────────────────────────────────────────────
# Small-tariff (green track) is capped at 15 kW. Otherwise the connection's
# power capacity (amperage / 1.44 ≈ √3·400V·I) is the MAX, and the recommended
# total AC capacity is the largest multiple of the smallest available inverter
# (the system can stack several units) that stays within that max. The min
# inverter size is category-specific (caller filters by product category, e.g.
# hybrid ≈ 6 kW, on-grid ≈ 10 kW). Server-only — the client gets just the kW.
SMALL_TARIFF_KEY = 'green_small'
SMALL_TARIFF_KW = 15.0
CONNECTION_DIVISOR = 1.44


def recommend_inverter_capacity(
    regulation_key: str | None,
    amperage_a: float | None,
    available_inverter_kws: list[float],
) -> float | None:
    """Recommended total inverter capacity (kW). Green track → 15; else the
    connection max (amperage/1.44) floored to a multiple of the smallest
    available inverter capacity (≥ one unit). Multiple inverters can be stacked
    to reach the total, so the granularity is the min unit, not a single
    inverter's size."""
    if regulation_key == SMALL_TARIFF_KEY:
        return SMALL_TARIFF_KW
    if not amperage_a or amperage_a <= 0:
        return None
    max_cap = amperage_a / CONNECTION_DIVISOR
    caps = [c for c in available_inverter_kws if c and c > 0]
    if not caps:
        # No catalog capacities to size against — fall back to the raw max.
        return round(max_cap, 1)
    min_cap = min(caps)
    units = math.floor(max_cap / min_cap)
    total = units * min_cap if units >= 1 else min_cap  # at least one unit
    return round(total, 1)


# ── Inverter auto-sizing ─────────────────────────────────────────────────────

def suggest_inverters(total_dc_w: float, inverter_products: list[Any]) -> list[dict]:
    """Rank inverter options by how close (qty × AC power) lands the DC:AC
    ratio to the target window. Returns suggestions sorted best-first."""
    suggestions = []
    for prod in inverter_products:
        spec = inverter_specs(prod)
        ac_w = spec['acPowerW']
        if not ac_w or ac_w <= 0 or total_dc_w <= 0:
            continue
        # Smallest qty whose combined AC power keeps ratio <= DCAC_MAX.
        qty = max(1, math.ceil(total_dc_w / (ac_w * DCAC_MAX)))
        ratio = total_dc_w / (ac_w * qty)
        type_key = getattr(prod, 'type_key', None) or (prod.get('type_key') if isinstance(prod, dict) else None)
        name = getattr(prod, 'name', None) or (prod.get('name') if isinstance(prod, dict) else None)
        suggestions.append({
            'typeKey': type_key,
            'name': name,
            'qty': qty,
            'acPowerW': ac_w,
            'dcAcRatio': round(ratio, 3),
            'inWindow': DCAC_MIN <= ratio <= DCAC_MAX,
        })
    # Prefer in-window, then closeness to target ratio.
    suggestions.sort(key=lambda s: (not s['inWindow'], abs(s['dcAcRatio'] - DCAC_TARGET)))
    return suggestions


# ── Panel grouping ───────────────────────────────────────────────────────────

def panels_by_area(panels: list[dict]) -> dict[int, list[dict]]:
    """Group real (non-empty) panels by their `area` index, each list sorted in
    series-wiring order: a serpentine (boustrophedon) column-major sweep — down
    one column, up the next — so a string fills a compact vertical block and
    consecutive panels in series are physically adjacent (see the row-line
    snake in the layout). Multi-row areas keep their `panelRowIdx` bands in
    order; the snake runs within each band."""
    groups: dict[int, list[dict]] = {}
    for p in panels:
        if p.get('isEmpty'):
            continue
        area = p.get('area')
        if area is None:
            continue
        groups.setdefault(area, []).append(p)
    for area, plist in groups.items():
        # Rank columns left→right so the up/down alternation is by adjacency,
        # not raw column number (which can skip values).
        cols_sorted = sorted({p.get('col', 0) for p in plist})
        col_rank = {c: i for i, c in enumerate(cols_sorted)}
        # Max row per band, used to flip odd columns bottom→top.
        max_row: dict = {}
        for p in plist:
            band = p.get('panelRowIdx', 0)
            max_row[band] = max(max_row.get(band, 0), p.get('row', 0))

        def key(p):
            band = p.get('panelRowIdx', 0)
            rank = col_rank[p.get('col', 0)]
            row = p.get('row', 0)
            serp = row if rank % 2 == 0 else (max_row[band] - row)
            return (band, rank, serp, p.get('id', 0))

        plist.sort(key=key)
    return groups


def _area_label(area_panels: list[dict], area_idx: int, label_by_area: dict[int, str]) -> str:
    if area_idx in label_by_area:
        return label_by_area[area_idx]
    # Fallback: alpha prefix of trapezoidId (e.g. 'A1' -> 'A'), else index.
    for p in area_panels:
        tid = p.get('trapezoidId') or ''
        prefix = ''.join(ch for ch in tid if ch.isalpha())
        if prefix:
            return prefix
    return f'Area {area_idx + 1}'


# ── Series-count sizing ──────────────────────────────────────────────────────

def _series_bounds(pspec: dict, ispec: dict, t_min: float, t_max: float) -> tuple[int | None, int | None]:
    """Max and min panels-in-series allowed by the MPPT window, or (None, None)
    if the inputs needed are missing."""
    voc = pspec['Voc']
    vmp = pspec['Vmp']
    vmax = ispec['mpptVmax']
    vmin = ispec['mpptVmin']
    sys_v = ispec['maxSystemVoltageV']
    if voc is None or vmp is None or vmax is None or vmin is None:
        return None, None

    voc_cold = _voc_at(voc, pspec['tempCoeffVoc'], t_min)
    vmp_hot = _vmp_at(vmp, pspec['tempCoeffVmp'], t_max)
    if voc_cold <= 0 or vmp_hot <= 0:
        return None, None

    ceiling_v = min(vmax, sys_v) if sys_v else vmax
    s_max = int(math.floor(ceiling_v / voc_cold))
    s_min = int(math.ceil(vmin / vmp_hot))
    return s_max, s_min


def _split_counts(n: int, s_max: int) -> list[int]:
    """Split n panels into the fewest near-equal strings each ≤ s_max."""
    k = max(1, math.ceil(n / s_max))
    base, rem = divmod(n, k)
    return [base + 1] * rem + [base] * (k - rem)


# ── String plan generation ───────────────────────────────────────────────────

def generate_string_plan(
    panels: list[dict],
    panel_product: Any,
    selected_inverters: list[Any],
    settings: dict | None,
    label_by_area: dict[int, str] | None = None,
) -> dict:
    """Auto-generate per-area equal-length strings and validate them.

    Returns {'strings': [...], 'issues': [...], 'summary': {...}}.
    A string never crosses areas. Series count per area is sized to the
    primary inverter's MPPT window using temp-corrected Voc/Vmp.
    """
    settings = settings or {}
    label_by_area = label_by_area or {}
    t_min = float(settings.get('designTempMinC', DEFAULT_DESIGN_TEMP_MIN_C))
    t_max = float(settings.get('designTempMaxCellC', DEFAULT_DESIGN_TEMP_MAX_CELL_C))

    pspec = panel_specs(panel_product)
    issues: list[dict] = []
    if panel_product is None:
        issues.append(_issue('missingPanelType', SEV_ERROR, 'panelType'))
    elif pspec['missing']:
        issues.append(_issue('missingPanelSpecs', SEV_ERROR, 'panel', specs=pspec['missing']))

    if not selected_inverters:
        issues.append(_issue('noInverterSelected', SEV_ERROR, 'inverters'))
        return {'strings': [], 'issues': issues, 'summary': {}}

    # Primary inverter drives series sizing (v1: first selected).
    primary = selected_inverters[0]
    ispec = inverter_specs(primary)
    primary_key = getattr(primary, 'type_key', None) or (primary.get('type_key') if isinstance(primary, dict) else None)
    if ispec['missing']:
        issues.append(_issue('missingInverterSpecs', SEV_ERROR, 'inverter',
                             typeKey=primary_key, specs=ispec['missing']))

    groups = panels_by_area(panels)
    s_max, s_min = _series_bounds(pspec, ispec, t_min, t_max)

    strings: list[dict] = []
    # Per-label running counter — two areas can resolve to the same label
    # (shared trapezoid prefix), so numbering must continue across them to keep
    # string ids globally unique.
    label_seq: dict[str, int] = {}
    # Total MPPT inputs across the selected fleet (qty handled by caller passing
    # repeated products); round-robin string→input assignment.
    total_inputs = sum(inverter_specs(inv)['mpptCount'] for inv in selected_inverters) or 1
    input_cursor = 0

    if s_max is not None and s_min is not None and s_max < s_min:
        issues.append(_issue('mpptWindowInfeasible', SEV_ERROR, 'inverter',
                             sMax=s_max, sMin=s_min))

    for area_idx in sorted(groups.keys()):
        area_panels = groups[area_idx]
        n = len(area_panels)
        if n == 0:
            continue
        label = _area_label(area_panels, area_idx, label_by_area)

        # Without a usable s_max, fall back to one string for the whole area so
        # the FE still has a grouping to render; validation flags the gap.
        if s_max is None or s_max < 1:
            counts = [n]
        else:
            counts = _split_counts(n, s_max)

        cursor = 0
        for length in counts:
            seg = area_panels[cursor:cursor + length]
            cursor += length
            label_seq[label] = label_seq.get(label, 0) + 1
            strings.append({
                'id': f'STR-{label}-{label_seq[label]:02d}',
                'areaLabel': label,
                'panelIds': [p.get('id') for p in seg],
                'inverterTypeKey': primary_key,
                'mpptIndex': input_cursor % total_inputs,
            })
            input_cursor += 1

    issues.extend(validate_string_plan(strings, panel_product, selected_inverters, settings))
    summary = {
        'stringCount': len(strings),
        'totalMpptInputs': total_inputs,
        'seriesMax': s_max,
        'seriesMin': s_min,
        'designTempMinC': t_min,
        'designTempMaxCellC': t_max,
    }
    return {'strings': strings, 'issues': _dedupe(issues), 'summary': summary}


# ── String plan validation ───────────────────────────────────────────────────

def validate_string_plan(
    strings: list[dict],
    panel_product: Any,
    selected_inverters: list[Any],
    settings: dict | None,
) -> list[dict]:
    """Validate an (auto-generated or manually-edited) string plan against the
    primary inverter's MPPT limits. Returns a list of structured issues."""
    settings = settings or {}
    t_min = float(settings.get('designTempMinC', DEFAULT_DESIGN_TEMP_MIN_C))
    t_max = float(settings.get('designTempMaxCellC', DEFAULT_DESIGN_TEMP_MAX_CELL_C))
    issues: list[dict] = []

    if not selected_inverters or panel_product is None:
        return issues  # generate_string_plan already reported the hard errors

    pspec = panel_specs(panel_product)
    ispec = inverter_specs(selected_inverters[0])
    voc, vmp, isc = pspec['Voc'], pspec['Vmp'], pspec['Isc']
    vmax, vmin = ispec['mpptVmax'], ispec['mpptVmin']
    sys_v = ispec['maxSystemVoltageV']
    max_i = ispec['maxInputCurrentA']

    if voc is not None and vmax is not None:
        voc_cold = _voc_at(voc, pspec['tempCoeffVoc'], t_min)
        ceiling = min(vmax, sys_v) if sys_v else vmax
        for s in strings:
            v = voc_cold * len(s.get('panelIds') or [])
            if v > ceiling:
                issues.append(_issue('stringVocExceedsMax', SEV_ERROR, 'string',
                                     stringId=s.get('id'), voc=round(v, 1), limit=round(ceiling, 1)))
    if vmp is not None and vmin is not None:
        vmp_hot = _vmp_at(vmp, pspec['tempCoeffVmp'], t_max)
        for s in strings:
            v = vmp_hot * len(s.get('panelIds') or [])
            if 0 < v < vmin:
                issues.append(_issue('stringVmpBelowMin', SEV_WARNING, 'string',
                                     stringId=s.get('id'), vmp=round(v, 1), limit=round(vmin, 1)))
    if isc is not None and max_i is not None:
        string_current = isc * CURRENT_SAFETY_FACTOR
        if string_current > max_i:
            issues.append(_issue('stringCurrentExceedsInput', SEV_ERROR, 'string',
                                 current=round(string_current, 2), limit=round(max_i, 2)))

    # Capacity: total strings vs total MPPT inputs × strings-per-input.
    total_capacity = sum(
        inverter_specs(inv)['mpptCount'] * inverter_specs(inv)['maxStringsPerMppt']
        for inv in selected_inverters
    )
    if total_capacity and len(strings) > total_capacity:
        issues.append(_issue('tooManyStrings', SEV_ERROR, 'inverters',
                             strings=len(strings), capacity=total_capacity))
    return issues


def _dedupe(issues: list[dict]) -> list[dict]:
    seen, out = set(), []
    for it in issues:
        # JSON key so list/dict params (e.g. specs=[...]) stay hashable.
        key = json.dumps(
            {'code': it['code'], 'field': it.get('field'), 'params': it.get('params', {})},
            sort_keys=True, default=str,
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out
