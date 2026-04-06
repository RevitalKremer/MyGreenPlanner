"""
BOM (Bill of Materials) computation service.
Ported from FE/src/utils/constructionCalculator.js — buildBOM().

All inputs are read from already-computed and persisted project data:
- step2.areas[].rails, bases, panelGrid  (computed in step 3)
- step3.trapezoidDetails[trapId].geometry (computed in step 3)
"""
import hashlib
import json
import math
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.bom import ProjectBOM
from app.models.product import Product
from app.services.settings_cache import get_setting


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def _count_panels(panel_grid: dict) -> int:
    """Count real panels (V/H) in a panel grid, excluding ghosts (EV/EH)."""
    total = 0
    for row in (panel_grid.get('rows') or []):
        for cell in row:
            if cell in ('V', 'H'):
                total += 1
    return total


def _count_lines(panel_grid: dict) -> int:
    """Number of panel lines (rows in the grid)."""
    return len(panel_grid.get('rows') or [])


def _get_area_field(area: dict, key: str, default=None):
    """
    Get a field from an area dict, handling both flat and nested formats.
    DB stores areas with flat fields (label, trapezoidIds directly on area),
    but the Pydantic schema nests them under 'settings'.
    """
    # Try flat first (actual DB format)
    val = area.get(key)
    if val is not None:
        return val
    # Try nested under 'settings' (Pydantic schema format)
    settings = area.get('settings')
    if isinstance(settings, dict):
        val = settings.get(key)
        if val is not None:
            return val
    return default


def _derive_row_construction(
    area: dict,
    computed_area: dict | None,
    computed_trapezoids: list[dict],
) -> dict | None:
    """
    Derive per-area row-construction data from step2 area + step3 computed data.
    Returns dict with keys matching FE rowConstructions, or None if data is incomplete.
    """
    if not computed_area:
        return None

    panel_grid = area.get('panelGrid') or {}
    rails = computed_area.get('rails') or []
    bases = computed_area.get('bases') or []
    trap_ids = _get_area_field(area, 'trapezoidIds') or []

    if not trap_ids:
        return None

    # Find geometry from first trapezoid's computed detail
    first_trap_id = trap_ids[0]
    detail = None
    for ct in computed_trapezoids:
        if ct.get('trapezoidId') == first_trap_id:
            detail = ct
            break
    geom = (detail or {}).get('geometry') or {}

    if not geom:
        return None

    angle = geom.get('angle', 0)
    front_height = geom.get('frontHeight', 0)
    height_rear = geom.get('heightRear', 0)
    height_front = geom.get('heightFront', 0)
    base_beam_length = geom.get('baseBeamLength', 0)
    top_beam_length = geom.get('topBeamLength', 0)
    diagonal_length = geom.get('diagonalLength', 0)
    base_length = geom.get('baseLength', 0)

    # Panel count
    panel_count = _count_panels(panel_grid)
    num_lines = _count_lines(panel_grid)
    if num_lines == 0:
        num_lines = 1

    # Rails
    num_rails = len(rails)

    # numRailConnectors: sum of (stockSegments.length - 1) across all rails
    num_rail_connectors = 0
    for r in rails:
        segs = r.get('stockSegmentsMm') or []
        if len(segs) > 1:
            num_rail_connectors += len(segs) - 1

    # rowLength: max span across all rails
    row_length = 0
    if rails:
        row_length = max(r.get('lengthCm', 0) for r in rails)

    # numLargeGaps: stored at area level by rail computation
    num_large_gaps = area.get('numLargeGaps', 0)

    # numTrapezoids: count unique base positions (distinct offsetFromStartCm)
    unique_base_positions = set()
    for b in bases:
        unique_base_positions.add(round(b.get('offsetFromStartCm', 0), 2))
    num_trapezoids = len(unique_base_positions) if unique_base_positions else 1

    return {
        'rowLength': row_length,
        'angle': angle,
        'frontHeight': front_height,
        'heightRear': height_rear,
        'heightFront': height_front,
        'baseLength': base_length,
        'baseBeamLength': base_beam_length,
        'topBeamLength': top_beam_length,
        'diagonalLength': diagonal_length,
        'numTrapezoids': num_trapezoids,
        'panelCount': panel_count,
        'numRails': num_rails,
        'numLines': num_lines,
        'numLargeGaps': num_large_gaps,
        'numRailConnectors': num_rail_connectors,
    }


def _compute_frame_bom(rc: dict, area_label: str) -> list[dict]:
    """Compute angle profile BOM for frame pieces (beams + legs)."""
    T = rc['numTrapezoids']
    num_inner_legs = max(0, rc.get('numRails', 2) - 2)
    angle_rad = rc['angle'] * math.pi / 180
    beam_thick_cm = rc['angleProfileSizeMm'] / 10
    avg_inner_leg_cm = (
        beam_thick_cm * (1 + math.cos(angle_rad) / 2)
        + (rc['heightRear'] + rc['heightFront']) / 2
    )

    frame_pieces = [
        p for p in [
            {'qty': T, 'lenCm': rc.get('baseBeamLength') or rc['baseLength']},
            {'qty': T, 'lenCm': rc['topBeamLength']},
            {'qty': T, 'lenCm': rc['heightRear']},
            {'qty': T, 'lenCm': rc['heightFront']},
            {'qty': num_inner_legs * T, 'lenCm': avg_inner_leg_cm},
        ]
        if p['qty'] > 0 and p['lenCm'] > 0
    ]
    frame_qty = sum(p['qty'] for p in frame_pieces)
    frame_length_m = sum(p['qty'] * p['lenCm'] for p in frame_pieces) / 100
    return [{'areaLabel': area_label, 'element': 'angle_profile_40x40', 'totalLengthM': frame_length_m, 'qty': frame_qty}]


def _compute_diagonal_bom(rc: dict, area_label: str) -> list[dict]:
    """Compute diagonal brace BOM."""
    T = rc['numTrapezoids']
    nS = T - 1
    if nS > 0 and rc['diagonalLength'] > 0:
        return [{'areaLabel': area_label, 'element': 'angle_profile_40x40_diag', 'totalLengthM': nS * rc['diagonalLength'] / 100, 'qty': nS}]
    return []


def _compute_rail_bom(rc: dict, area_label: str) -> list[dict]:
    """Compute rail profiles + connectors + end caps BOM."""
    num_rails = rc.get('numRails', 2)
    num_rail_connectors = rc.get('numRailConnectors', 0)
    rows = []
    rail_total = num_rails * rc['rowLength'] / 100 if rc.get('rowLength') else None
    rows.append({'areaLabel': area_label, 'element': 'rail_40x40', 'totalLengthM': rail_total, 'qty': num_rails})
    rows.append({'areaLabel': area_label, 'element': 'rail_end_cap', 'totalLengthM': None, 'qty': 2 * num_rails})
    if num_rail_connectors > 0:
        rows.append({'areaLabel': area_label, 'element': 'rail_connector', 'totalLengthM': None, 'qty': num_rail_connectors})
    return rows


def _compute_block_bom(rc: dict, area_label: str) -> list[dict]:
    """Compute blocks + bitumen sheets + jumbo bolts BOM."""
    T = rc['numTrapezoids']
    num_inner_legs = max(0, rc.get('numRails', 2) - 2)
    block_qty = T * (2 + num_inner_legs)
    return [
        {'areaLabel': area_label, 'element': 'block_50x24x15', 'totalLengthM': None, 'qty': block_qty},
        {'areaLabel': area_label, 'element': 'bitumen_sheets', 'totalLengthM': None, 'qty': block_qty},
        {'areaLabel': area_label, 'element': 'jumbo_5x16', 'totalLengthM': None, 'qty': block_qty},
    ]


def _compute_panel_clamp_bom(rc: dict, area_label: str) -> list[dict]:
    """Compute all panel clamp types (end, grounding, mid) BOM."""
    num_rails = rc.get('numRails', 2)
    num_lines = rc.get('numLines', 1)
    num_large_gaps = rc.get('numLargeGaps', 0)
    panel_count = rc.get('panelCount', 0)
    rows = []

    rails_per_line = num_rails / num_lines if num_lines else num_rails
    end_clamp_qty = 2 * num_rails + 2 * num_large_gaps * rails_per_line
    rows.append({'areaLabel': area_label, 'element': 'end_panel_clamp', 'totalLengthM': None, 'qty': round(end_clamp_qty)})

    grounding_qty = math.ceil(panel_count / 2)
    rows.append({'areaLabel': area_label, 'element': 'grounding_panel_clamp', 'totalLengthM': None, 'qty': grounding_qty})

    panels_per_line = panel_count / num_lines if num_lines else panel_count
    total_boundaries = max(0, panels_per_line - 1) * num_lines
    normal_boundaries = max(0, total_boundaries - num_large_gaps)
    mid_clamp_qty = max(0, round(normal_boundaries * rails_per_line) - grounding_qty)
    if mid_clamp_qty > 0:
        rows.append({'areaLabel': area_label, 'element': 'mid_panel_clamp', 'totalLengthM': None, 'qty': mid_clamp_qty})

    return rows


def _compute_bolt_bom(rc: dict, area_label: str) -> list[dict]:
    """Compute hex bolts + flange nuts BOM."""
    T = rc['numTrapezoids']
    num_rails = rc.get('numRails', 2)
    num_inner_legs = max(0, num_rails - 2)
    legs_per_trapezoid = 2 + num_inner_legs
    hex_bolt_qty = T * (2 * legs_per_trapezoid + 2) + num_rails * T
    return [
        {'areaLabel': area_label, 'element': 'hex_head_bolt_m8x20', 'totalLengthM': None, 'qty': hex_bolt_qty},
        {'areaLabel': area_label, 'element': 'flange_nut_m8_stainless_steel', 'totalLengthM': None, 'qty': hex_bolt_qty},
    ]


def build_bom(row_constructions: list[dict], row_labels: list[str]) -> list[dict]:
    """
    Build per-area bill of materials.
    Direct port of FE constructionCalculator.js → buildBOM().
    Returns list of { areaLabel, element, totalLengthM, qty }.
    """
    rows: list[dict] = []

    for i, rc in enumerate(row_constructions):
        area_label = row_labels[i] if i < len(row_labels) else f'Area {i + 1}'

        rows += _compute_frame_bom(rc, area_label)
        rows += _compute_diagonal_bom(rc, area_label)
        rows += _compute_rail_bom(rc, area_label)
        rows += _compute_block_bom(rc, area_label)
        rows += _compute_panel_clamp_bom(rc, area_label)
        rows += _compute_bolt_bom(rc, area_label)

    return rows


def enrich_bom_with_products(
    bom_items: list[dict],
    products_by_type: dict[str, dict],
) -> list[dict]:
    """Add product details (name, partNumber, etc.) to each BOM item."""
    enriched = []
    for item in bom_items:
        prod = products_by_type.get(item['element'])
        enriched.append({
            **item,
            'productId': str(prod['id']) if prod else None,
            'partNumber': prod['part_number'] if prod else None,
            'name': prod['name'] if prod else None,
            'nameHe': prod['name_he'] if prod else None,
            'extraPct': prod['extra'] if prod else None,
            'altGroup': prod['alt_group'] if prod else None,
        })
    return enriched


def compute_input_hash(data: dict) -> str:
    """SHA-256 hash of step3 computed data relevant to BOM computation."""
    step3 = data.get('step3', {})
    relevant = {
        'computedAreas': step3.get('computedAreas', []),
        'computedTrapezoids': step3.get('computedTrapezoids', []),
    }
    raw = json.dumps(relevant, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


# ---------------------------------------------------------------------------
# DB-aware orchestrators
# ---------------------------------------------------------------------------

async def get_bom(db: AsyncSession, project_id: uuid.UUID) -> ProjectBOM | None:
    result = await db.execute(
        select(ProjectBOM).where(ProjectBOM.project_id == project_id)
    )
    return result.scalar_one_or_none()


def is_bom_stale(project_data: dict, bom: ProjectBOM) -> bool:
    """Check if stored BOM is outdated relative to current project data."""
    if bom.input_hash != compute_input_hash(project_data):
        return True
    # Also stale if items lack nameHe (pre-translation BOM)
    items = bom.items or []
    if items and 'nameHe' not in items[0]:
        return True
    return False


async def _load_products_by_type(db: AsyncSession) -> dict[str, dict]:
    """Load all active material products keyed by type_key."""
    result = await db.execute(
        select(Product).where(Product.active == True, Product.product_type == 'material')
    )
    products = result.scalars().all()
    return {
        p.type_key: {
            'id': p.id,
            'type_key': p.type_key,
            'part_number': p.part_number,
            'name': p.name,
            'name_he': p.name_he,
            'extra': p.extra,
            'alt_group': p.alt_group,
        }
        for p in products
    }


async def compute_and_save_bom(db: AsyncSession, project) -> ProjectBOM:
    """
    Compute BOM from project's step2/step3 data, enrich with products, and upsert.
    """
    data = project.data or {}
    step2 = data.get('step2', {})
    step3 = data.get('step3', {})
    areas = step2.get('areas', [])
    computed_areas = step3.get('computedAreas', [])
    computed_trapezoids = step3.get('computedTrapezoids', [])

    # Get angleProfileSizeMm from settings cache (no DB call)
    angle_profile_size_mm = get_setting('angleProfileSizeMm')

    roof_spec = project.roof_spec or {'type': 'concrete'}
    roof_type = roof_spec.get('type', 'concrete')

    # Build label → computedArea lookup
    ca_by_label = {ca.get('label'): ca for ca in computed_areas}

    # Derive row constructions for each area
    row_constructions = []
    row_labels = []
    for area in areas:
        label = _get_area_field(area, 'label', f'Area {len(row_labels) + 1}')
        ca = ca_by_label.get(label)
        rc = _derive_row_construction(area, ca, computed_trapezoids)
        if rc is None:
            continue
        # Add angleProfileSizeMm from app_settings to each row construction
        rc['angleProfileSizeMm'] = angle_profile_size_mm
        rc['roofType'] = roof_type
        row_constructions.append(rc)
        row_labels.append(label)

    # Build BOM
    bom_items = build_bom(row_constructions, row_labels)

    # Enrich with product data
    products_by_type = await _load_products_by_type(db)
    enriched_items = enrich_bom_with_products(bom_items, products_by_type)

    # Compute hash for staleness detection
    input_hash = compute_input_hash(data)

    # Upsert: find existing or create new
    existing = await get_bom(db, project.id)
    if existing:
        existing.items = enriched_items
        existing.input_hash = input_hash
        existing.updated_at = datetime.now(timezone.utc)
        flag_modified(existing, 'items')
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        bom = ProjectBOM(
            project_id=project.id,
            items=enriched_items,
            input_hash=input_hash,
        )
        db.add(bom)
        await db.commit()
        await db.refresh(bom)
        return bom


def apply_bom_deltas(
    bom_items: list[dict],
    bom_deltas: dict,
) -> list[dict]:
    """
    Merge bomDeltas (overrides, additions, alternatives) onto base BOM items.
    Returns the effective BOM list.
    """
    overrides = bom_deltas.get('overrides') or {}
    additions = bom_deltas.get('additions') or []
    alternatives = bom_deltas.get('alternatives') or {}

    effective = []
    for item in bom_items:
        key = f"{item['areaLabel']}||{item['element']}"
        ov = overrides.get(key)
        if ov and ov.get('removed'):
            continue
        entry = {**item}
        if ov:
            if 'qty' in ov:
                entry['qty'] = ov['qty']
            if 'extras' in ov:
                entry['extras'] = ov['extras']
        # Apply alternative product substitution
        alt_element = alternatives.get(entry['element'])
        if alt_element:
            entry['altElement'] = alt_element
        effective.append(entry)

    # Append user-added items
    for add in additions:
        effective.append({
            'areaLabel': add.get('areaLabel', ''),
            'element': add.get('element', ''),
            'totalLengthM': add.get('totalLengthM'),
            'qty': add.get('qty', 0),
            'extras': add.get('extras', 0),
            'productId': add.get('productId'),
            'partNumber': add.get('partNumber'),
            'name': add.get('name'),
            'extraPct': None,
            'altGroup': None,
        })

    return effective
