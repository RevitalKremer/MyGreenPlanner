"""
Regression test: verify concrete roof trapezoid detail computation
produces identical output to stored fixture data.

Run: cd BE/mgp-service && python -m tests.test_concrete_regression
"""
import json
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.trapezoid_detail_service import compute_trapezoid_details, align_blocks
from app.utils.math_helpers import round_to_1dp
from app.utils.panel_geometry import PANEL_V, PANEL_H, EMPTY_ORIENTATIONS

FIXTURES_DIR = Path(__file__).parent / 'fixtures'

# Default app_settings — matches DB defaults used to generate fixtures
APP_DEFAULTS = {
    'blockHeightCm': 15,
    'blockLengthCm': 50,
    'blockWidthCm': 24,
    'blockPunchCm': 9,
    'diagTopPct': 25,
    'diagBasePct': 90,
    'baseOverhangCm': 5,
    'crossRailEdgeDistMm': 40,
    'angleProfileSizeMm': 40,
    'panelThickCm': 3.5,
    'panelGapCm': 2.5,
    'lineGapCm': 2,
    'diagSkipBelowCm': 60,
    'diagDoubleAboveCm': 200,
    'punchOverlapMarginCm': 2,
    'punchInnerOffsetCm': 8,
    'purlinBufferCm': 5,
    'extendFront': True,
    'extendRear': True,
}


def _derive_line_rails(computed_area: dict | None) -> dict[str, list[float]]:
    if not computed_area:
        return {}
    derived: dict[str, list] = {}
    for r in computed_area.get('rails', []):
        li = str(r.get('lineIdx', 0))
        off = r.get('offsetFromLineFrontCm')
        if off is not None:
            derived.setdefault(li, []).append(off)
    return {li: sorted(offs) for li, offs in derived.items()}


def _get_computed_area(data: dict, area_id: int) -> dict | None:
    for ca in data.get('step3', {}).get('computedAreas', []):
        if ca.get('areaId') == area_id:
            return ca
    return None


def _build_inputs_for_trap(data: dict, trap_id: str, trap_cfg: dict, area: dict):
    """Replicate the input derivation from projects.compute_and_save_trapezoid_details."""
    step2 = data.get('step2', {})
    area_id = area.get('id', 0)
    line_orients = trap_cfg.get('lineOrientations', [PANEL_V])

    computed_area = _get_computed_area(data, area_id)
    all_line_rails = _derive_line_rails(computed_area)

    # Filter to active lines only
    line_rails = {
        li: offs for li, offs in all_line_rails.items()
        if int(li) < len(line_orients) and line_orients[int(li)] not in EMPTY_ORIENTATIONS
    }

    # Build panel_lines and remap line_rails
    panel_lines = []
    remapped = {}
    active_idx = 0
    for li, orient in enumerate(line_orients):
        if orient in EMPTY_ORIENTATIONS:
            continue
        is_h = orient == PANEL_H
        depth = step2['panelWidthCm'] if is_h else step2['panelLengthCm']
        gap = APP_DEFAULTS['lineGapCm'] if active_idx > 0 else 0
        if str(li) in line_rails:
            remapped[str(active_idx)] = line_rails[str(li)]
        panel_lines.append({
            'depthCm': depth, 'gapBeforeCm': gap,
            'isEmpty': False, 'isHorizontal': is_h,
        })
        active_idx += 1
    line_rails = remapped

    angle = trap_cfg.get('angleDeg', 0)
    front_height = trap_cfg.get('frontHeightCm', 0)
    base_overhang = APP_DEFAULTS['baseOverhangCm']

    # Derive bases_data
    bases_data = None
    if line_rails:
        all_rail_offsets = []
        d_cm = 0.0
        for si, seg in enumerate(panel_lines):
            d_cm += seg.get('gapBeforeCm', 0)
            for off in line_rails.get(str(si), []):
                all_rail_offsets.append(d_cm + off)
            d_cm += seg.get('depthCm', 0)
        if all_rail_offsets:
            first_rail = min(all_rail_offsets)
            last_rail = max(all_rail_offsets)
            bases_data = {
                'baseLengthCm': round_to_1dp(last_rail + base_overhang - (first_rail - base_overhang)),
                'rearLegDepthCm': round_to_1dp(first_rail),
                'frontLegDepthCm': round_to_1dp(last_rail),
            }

    rail_offset_cm = float(line_rails.get('0', [0])[0]) if line_rails.get('0') else 0

    custom_diags = data.get('step3', {}).get('customDiagonals', {}).get(trap_id)

    return {
        'bases_data': bases_data,
        'line_rails': line_rails,
        'panel_lines': panel_lines,
        'angle_deg': angle,
        'front_height_cm': front_height,
        'rail_offset_cm': rail_offset_cm,
        'settings': APP_DEFAULTS,
        'overrides': {},
        'custom_diagonals': custom_diags,
        'global_settings': {},
        'roof_spec': {'type': 'concrete'},
    }


def _compare(expected, actual, path=''):
    """Deep compare dicts/lists, return list of diff strings."""
    diffs = []
    if isinstance(expected, dict) and isinstance(actual, dict):
        all_keys = set(expected) | set(actual)
        for k in sorted(all_keys):
            if k not in expected:
                diffs.append(f'{path}.{k}: EXTRA in actual = {actual[k]}')
            elif k not in actual:
                diffs.append(f'{path}.{k}: MISSING in actual (expected {expected[k]})')
            else:
                diffs += _compare(expected[k], actual[k], f'{path}.{k}')
    elif isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            diffs.append(f'{path}: length {len(expected)} vs {len(actual)}')
        for i in range(min(len(expected), len(actual))):
            diffs += _compare(expected[i], actual[i], f'{path}[{i}]')
    elif isinstance(expected, float) and isinstance(actual, float):
        if abs(expected - actual) > 0.15:
            diffs.append(f'{path}: {expected} vs {actual}')
    elif expected != actual:
        diffs.append(f'{path}: {expected!r} vs {actual!r}')
    return diffs


def run_fixture(fixture_path: Path):
    print(f'\n{"="*60}')
    print(f'Testing: {fixture_path.name}')
    print(f'{"="*60}')

    with open(fixture_path) as f:
        fixture = json.load(f)

    data = fixture['data']
    step2 = data.get('step2', {})
    step3 = data.get('step3', {})

    # Build trapezoid lookup
    traps_list = step2.get('trapezoids', [])
    traps_by_id = {t['id']: t for t in traps_list if 'id' in t}
    areas = step2.get('areas', [])

    # Expected: stored computedTrapezoids
    expected_by_id = {}
    for ct in step3.get('computedTrapezoids', []):
        expected_by_id[ct['trapezoidId']] = ct

    # Group traps by area for align_blocks
    area_traps_map = {}  # area_label -> { trap_id -> area }
    for a in areas:
        label = a.get('label', '')
        for tid in a.get('trapezoidIds', []):
            area_traps_map.setdefault(label, {})[tid] = a

    # Compute all full traps first
    computed = {}  # trap_id -> detail
    for trap_id, trap_cfg in traps_by_id.items():
        area = None
        for a in areas:
            if trap_id in a.get('trapezoidIds', []):
                area = a
                break
        if not area:
            continue
        expected = expected_by_id.get(trap_id)
        if not expected or not expected.get('isFullTrap', True):
            continue
        inputs = _build_inputs_for_trap(data, trap_id, trap_cfg, area)
        detail = compute_trapezoid_details(**inputs)
        if detail:
            detail['isFullTrap'] = True
            computed[trap_id] = detail

    # Run align_blocks per area (same as server pipeline)
    for label, tid_map in area_traps_map.items():
        area_details = {tid: computed[tid] for tid in tid_map if tid in computed}
        if len(area_details) >= 2:
            align_blocks(area_details)
            computed.update(area_details)

    # Compare
    total = 0
    passed = 0
    failed_traps = []

    for trap_id, actual in computed.items():
        expected = expected_by_id.get(trap_id)
        if not expected:
            continue

        total += 1
        diffs = []
        for key in ('geometry', 'legs', 'blocks', 'diagonals', 'punches'):
            if key in expected:
                diffs += _compare(expected[key], actual.get(key), key)

        if diffs:
            print(f'  FAIL {trap_id}: {len(diffs)} diff(s)')
            for d in diffs[:10]:
                print(f'    {d}')
            if len(diffs) > 10:
                print(f'    ... and {len(diffs) - 10} more')
            failed_traps.append(trap_id)
        else:
            print(f'  PASS {trap_id}')
            passed += 1

    print(f'\nResults: {passed}/{total} passed')
    if failed_traps:
        print(f'Failed: {", ".join(failed_traps)}')
    return len(failed_traps) == 0


if __name__ == '__main__':
    all_pass = True
    for fixture_path in sorted(FIXTURES_DIR.glob('*.json')):
        if not run_fixture(fixture_path):
            all_pass = False

    print(f'\n{"="*60}')
    if all_pass:
        print('ALL FIXTURES PASSED')
    else:
        print('SOME FIXTURES FAILED')
        sys.exit(1)
