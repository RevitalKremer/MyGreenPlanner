"""Generate a Hebrew price proposal (.xlsx) from a project's BOM.

Loads `app/templates/proposal_template.xlsx`, fills the two sheets
(`pricing` and `quantities`) with project metadata + BOM data, returns the
populated workbook as bytes for download.

The template uses literal placeholder strings inside cells as the contract
between the file and this code:
    CUSTOMER_NAME           – customer/client name
    PROJECT_NAME            – project name
    PROPOSAL_DATE           – proposal date (today)
    QTY_TABLE_DATA_ROW      – first BOM data row on the quantities sheet
    PRICE_TABLE_DATA_ROW    – first BOM data row on the pricing sheet

The placeholder cell is overwritten by the code; the row that holds it is
the styling prototype every BOM line is copied from. Rows below the data
anchor (totals, VAT, terms, signatures) are pushed down with insert_rows,
and SUM ranges in the totals row are rewritten to span the new data block.
"""
from __future__ import annotations

import io
import re
import uuid
import xml.etree.ElementTree as ET
from copy import copy
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import Product
from app.services import bom_service


TEMPLATE_PATH = Path(__file__).resolve().parents[1] / 'templates' / 'proposal_template.xlsx'


# Section labels in Hebrew (proposal is Hebrew-only regardless of app lang).
_SECTION_LABEL_HE = {
    'rails':              '── קושרות ──',
    'trapezoids':         '── טרפזים ──',
    'diagonals_external': '── דיאגונלים ──',
    'other':              '── אביזרי עזר ──',
}

# Order rows are emitted in (mirrors the proposal template screenshot).
_SECTION_ORDER = ['rails', 'trapezoids', 'diagonals_external', 'other']


# ───────────────────────────────────────────────────────────────────────
# Row preparation
# ───────────────────────────────────────────────────────────────────────

def _classify(item: dict) -> str:
    section = item.get('section')
    if section in _SECTION_LABEL_HE:
        return section
    if item.get('element') == 'rail_40x40' and item.get('pieceLengthM') is not None:
        return 'rails'
    return 'other'


def _build_data_row(line_num: int, item: dict, product: Product | None) -> dict:
    """Produce one filled-in row dict matching the template's column layout."""
    qty = item.get('qty', 0) or 0
    piece_length = item.get('pieceLengthM')
    is_length_row = piece_length is not None

    price_per_unit = (product.price_ils if product else None) or 0.0
    weight_per_unit = (product.weight_kg if product else None) or 0.0
    dep_pct = (product.depreciation_pct if product else None) or 0.0

    if is_length_row:
        # Length items: price and weight are per metre, multiplied by total length.
        total_length = piece_length * qty
        total_weight = total_length * weight_per_unit
        total_price = total_length * price_per_unit
        # Column G shows total weight for length items (kg).
        qty_kg_or_units = round(total_weight, 3)
    else:
        total_weight = qty * weight_per_unit
        total_price = qty * price_per_unit
        # Column G shows the piece count for piece items (units).
        qty_kg_or_units = qty

    # Depreciation: percent uplift on quantity → extra cost = total_price × dep%.
    dep_qty = round(qty * dep_pct / 100, 4) if dep_pct else 0
    total_with_dep = round(total_price * (1 + dep_pct / 100), 2) if dep_pct else round(total_price, 2)

    return {
        'is_section_header':       False,
        'line_num':                line_num,
        'location':                item.get('areaLabel') or '',
        'product_name_he':         (product.name_he if product else None) or item.get('name') or item.get('element', ''),
        'length_m':                round(piece_length, 2) if is_length_row else None,
        'qty':                     qty,
        'qty_kg_or_units':         qty_kg_or_units,
        'unit_price_ils':          round(price_per_unit, 2),
        'total_price_ils':         round(total_price, 2),
        'depreciation_qty':        dep_qty,
        'total_with_depreciation': total_with_dep,
        'weight_kg':               round(total_weight, 3),
    }


def _build_section_header_row(section_key: str) -> dict:
    return {
        'is_section_header': True,
        'line_num':          '---',
        'location':          '',
        'product_name_he':   _SECTION_LABEL_HE[section_key],
        'length_m':          None,
        'qty':               '',
        'qty_kg_or_units':   '',
        'unit_price_ils':    '',
        'total_price_ils':   '',
        'depreciation_qty':  '',
        'total_with_depreciation': '',
        'weight_kg':         '',
    }


def build_proposal_rows(bom_items: list[dict], products_by_type: dict[str, Product]) -> list[dict]:
    """Group BOM items into the four proposal sections, prepend a section
    header to each non-empty group, and number data rows continuously
    (section headers carry '---' in the line# column, like the BOM Excel)."""
    grouped: dict[str, list[dict]] = {k: [] for k in _SECTION_ORDER}
    for it in bom_items:
        grouped[_classify(it)].append(it)

    rows: list[dict] = []
    line_num = 0
    for sect in _SECTION_ORDER:
        items = grouped[sect]
        if not items:
            continue
        rows.append(_build_section_header_row(sect))
        for it in items:
            line_num += 1
            rows.append(_build_data_row(line_num, it, products_by_type.get(it.get('element'))))
    return rows


# ───────────────────────────────────────────────────────────────────────
# Template fill
# ───────────────────────────────────────────────────────────────────────

# Maps row dict keys to template column letters (RTL: B is leftmost in the
# physical XML, but renders rightmost in Excel — that's the template author's
# concern, not ours; we just write into the columns the template already has).
_COLUMN_MAP = {
    'line_num':                'B',
    'location':                'C',
    'product_name_he':         'D',
    'length_m':                'E',
    'qty':                     'F',
    'qty_kg_or_units':         'G',
    'unit_price_ils':          'H',
    'total_price_ils':         'I',
    'depreciation_qty':        'J',
    'total_with_depreciation': 'K',
    'weight_kg':               'L',
}

_PLACEHOLDER_FIELDS = {'CUSTOMER_NAME', 'PROJECT_NAME', 'PROPOSAL_DATE'}


# Cell reference pattern: optional $, A-Z letters, optional $, digits.
_CELL_REF_RE = re.compile(r'(?<![A-Za-z0-9_$])(\$?)([A-Z]+)(\$?)(\d+)')

# SUM(<col>X:<col>Y) with optional $ anchors — used to detect the column-total
# formulas in the original totals row so we can re-aim them at the new block.
_SUM_RE = re.compile(r'^=SUM\((\$?)([A-Z]+)(\$?)(\d+):(\$?)([A-Z]+)(\$?)(\d+)\)$', re.IGNORECASE)


def _shift_formula_refs(formula: str, threshold_row: int, shift: int) -> str:
    """Shift the row component of every cell reference whose row is >= threshold."""
    def repl(m):
        col_abs, col, row_abs, row = m.group(1), m.group(2), m.group(3), int(m.group(4))
        if row >= threshold_row:
            return f'{col_abs}{col}{row_abs}{row + shift}'
        return m.group(0)
    return _CELL_REF_RE.sub(repl, formula)


def _copy_cell_style(src, dst) -> None:
    if not src.has_style:
        return
    dst.font          = copy(src.font)
    dst.fill          = copy(src.fill)
    dst.border        = copy(src.border)
    dst.alignment     = copy(src.alignment)
    dst.number_format = src.number_format
    dst.protection    = copy(src.protection)


def _extend_print_area(ws, anchor_row: int, n: int) -> None:
    """Push the print area's bottom row down by `n - 1` so it still covers the
    same template content (totals, legal text, signature) after our row
    insertion. Column range is left untouched, per spec."""
    if n <= 1:
        return
    pa = ws.print_area
    if not pa:
        return
    pa_str = pa[0] if isinstance(pa, list) else pa
    if not pa_str:
        return
    # Print area strings come back like "'pricing'!$A$1:$I$28" — peel off the sheet prefix.
    sheet_prefix = ''
    body = pa_str
    if '!' in body:
        sheet_prefix, body = body.rsplit('!', 1)
        sheet_prefix += '!'
    from openpyxl.utils.cell import range_boundaries, get_column_letter
    try:
        min_col, min_row, max_col, max_row = range_boundaries(body.replace('$', ''))
    except Exception:
        return
    if max_row < anchor_row:
        return  # print area sits entirely above the data block; nothing to grow.
    new_max_row = max_row + (n - 1)
    ws.print_area = (
        f"{sheet_prefix}${get_column_letter(min_col)}${min_row}:"
        f"${get_column_letter(max_col)}${new_max_row}"
    )


def _extend_excel_table(ws, anchor_row: int, n: int) -> None:
    """Grow any Excel Table whose first data row equals `anchor_row` to span
    `n` data rows. Excel applies the table's style (row stripes) and the
    calculated-column formulas to every row inside `table.ref`, so this is
    what makes new rows inherit the template's table formatting + auto-totals.
    """
    from openpyxl.utils.cell import range_boundaries, get_column_letter
    last_data_row = anchor_row + n - 1
    for table_name in list(ws.tables):
        table = ws.tables[table_name]
        try:
            min_col, min_row, max_col, max_row = range_boundaries(table.ref)
        except Exception:
            continue
        first_data = min_row + (table.headerRowCount or 1)
        if first_data != anchor_row:
            continue
        new_ref = f"{get_column_letter(min_col)}{min_row}:{get_column_letter(max_col)}{last_data_row}"
        table.ref = new_ref
        if table.autoFilter is not None:
            table.autoFilter.ref = new_ref


def _shift_row_dimensions(ws, insert_row: int, shift: int, anchor_row: int) -> None:
    """openpyxl 3.1's insert_rows leaves `row_dimensions` keyed at the
    original row numbers, which means custom row heights below the insert
    point end up on the wrong rows (e.g. the 74pt legal-paragraph row stays
    at row 28 even though its content moved to row 36). Shift them manually,
    then copy the anchor row's height onto every newly-inserted row so the
    table body is uniform.
    """
    if shift <= 0:
        return
    # Walk highest-first to avoid colliding with rows we're about to overwrite.
    for r in sorted([k for k in list(ws.row_dimensions) if k >= insert_row], reverse=True):
        dim = ws.row_dimensions[r]
        del ws.row_dimensions[r]
        new_r = r + shift
        dim.r = new_r
        ws.row_dimensions[new_r] = dim

    anchor_dim = ws.row_dimensions.get(anchor_row)
    if anchor_dim is not None and anchor_dim.height is not None:
        # `RowDimension.customHeight` is a read-only property that's True iff
        # `height` is set, so just assigning height is enough.
        for r in range(insert_row, insert_row + shift):
            ws.row_dimensions[r].height = anchor_dim.height


def _shift_merged_ranges(ws, insert_row: int, shift: int) -> None:
    """Move every merged range that starts at or below `insert_row` down by
    `shift`. openpyxl 3.1's insert_rows leaves merge ranges unshifted, which
    causes writes to cells trapped under a stale merge to silently disappear.
    Call this BEFORE insert_rows so the merges land at the right rows once
    the row insertion completes.
    """
    if shift <= 0:
        return
    to_shift = [mr for mr in ws.merged_cells.ranges if mr.min_row >= insert_row]
    for mr in to_shift:
        c1 = get_column_letter(mr.min_col)
        c2 = get_column_letter(mr.max_col)
        ws.unmerge_cells(str(mr))
        ws.merge_cells(f'{c1}{mr.min_row + shift}:{c2}{mr.max_row + shift}')


def _fill_sheet(ws, anchor_placeholder: str, rows: list[dict], ctx: dict) -> None:
    # 1. Walk every cell once: replace the static placeholders, find the anchor.
    anchor_row = None
    for excel_row in ws.iter_rows():
        for cell in excel_row:
            if cell.value is None:
                continue
            v = str(cell.value).strip()
            if v in _PLACEHOLDER_FIELDS:
                cell.value = ctx.get(v, '')
            elif v == anchor_placeholder:
                anchor_row = cell.row
                cell.value = None  # clear; we'll fill it with the first BOM row

    if anchor_row is None:
        raise ValueError(f"{ws.title}: anchor placeholder {anchor_placeholder!r} not found")

    n = len(rows)
    if n == 0:
        return
    shift = n - 1
    last_data_row = anchor_row + n - 1

    # 2. openpyxl doesn't rewrite formula text on insert_rows, so capture every
    #    formula below the anchor BEFORE inserting; we re-apply them with
    #    properly-shifted row references at their new positions afterwards.
    captured_formulas: list[tuple[int, int, str]] = []
    if shift > 0:
        for r in range(anchor_row + 1, ws.max_row + 1):
            for c in range(1, ws.max_column + 1):
                v = ws.cell(r, c).value
                if isinstance(v, str) and v.startswith('='):
                    captured_formulas.append((r, c, v))
        _shift_merged_ranges(ws, anchor_row + 1, shift)
        _shift_row_dimensions(ws, anchor_row + 1, shift, anchor_row)
        ws.insert_rows(anchor_row + 1, amount=shift)
        # Inserted rows are blank-styled — copy the anchor row's formatting.
        for offset in range(1, n):
            target = anchor_row + offset
            for c in range(1, ws.max_column + 1):
                _copy_cell_style(ws.cell(anchor_row, c), ws.cell(target, c))

    # 3. Fill data rows. Empty/None values are left blank (don't write '').
    for offset, row in enumerate(rows):
        excel_row_idx = anchor_row + offset
        for key, col_letter in _COLUMN_MAP.items():
            val = row.get(key)
            if val == '' or val is None:
                ws.cell(excel_row_idx, _col_to_idx(col_letter)).value = None
            else:
                ws.cell(excel_row_idx, _col_to_idx(col_letter)).value = val

    # 3b. Grow the Excel Table that owns the anchor so its style + calculated
    #     columns apply to every new row.
    _extend_excel_table(ws, anchor_row, n)

    # 3c. Push the print area's bottom row down so the printout still ends
    #     where the template intended (after totals/legal text), but now
    #     covers all the new data rows too.
    _extend_print_area(ws, anchor_row, n)

    # 4. Rewrite captured formulas at their new row positions.
    #    - SUM(col X:col X) was a placeholder spanning only the template's
    #      sample data row; expand it to span the full data block.
    #    - Every other formula keeps its shape but row-references that pointed
    #      into the totals/footer block (rows >= original anchor + 1) shift
    #      down by `shift` so chains like `=N12 → =I13*18% → =I14+I13` stay
    #      consistent.
    for orig_r, orig_c, formula in captured_formulas:
        new_r = orig_r + shift
        cell = ws.cell(new_r, orig_c)
        m = _SUM_RE.match(formula)
        if m and m.group(2) == m.group(6):
            col = m.group(2)
            cell.value = f'=SUM({col}{anchor_row}:{col}{last_data_row})'
        else:
            cell.value = _shift_formula_refs(formula, threshold_row=anchor_row + 1, shift=shift)


def _col_to_idx(letter: str) -> int:
    return ord(letter.upper()) - ord('A') + 1


# ───────────────────────────────────────────────────────────────────────
# Orchestrator
# ───────────────────────────────────────────────────────────────────────

async def _load_products_by_type(db: AsyncSession) -> dict[str, Product]:
    result = await db.execute(select(Product).where(Product.active == True))
    return {p.type_key: p for p in result.scalars().all()}


async def generate_proposal(db: AsyncSession, project) -> bytes:
    """Build the price proposal xlsx for `project` and return the bytes."""
    bom = await bom_service.get_bom(db, project.id)
    if bom is None or bom_service.is_bom_stale(project.data or {}, bom):
        bom = await bom_service.compute_and_save_bom(db, project)

    deltas = ((project.data or {}).get('step5') or {}).get('bomDeltas') or {}
    effective_items = bom_service.apply_bom_deltas(bom.items, deltas)

    products_by_type = await _load_products_by_type(db)
    proposal_rows = build_proposal_rows(effective_items, products_by_type)

    if not TEMPLATE_PATH.exists():
        raise FileNotFoundError(f"Proposal template not found at {TEMPLATE_PATH}")
    wb = load_workbook(TEMPLATE_PATH)

    today = datetime.now(timezone.utc).strftime('%-d/%-m/%Y')
    # No first-class "customer" field on Project — read from project.data.step5
    # (where step 5 can stash extra metadata) and fall back to blank. The
    # generated xlsx leaves the cell empty for the user to fill in by hand.
    step5 = (project.data or {}).get('step5') or {}
    ctx = {
        'CUSTOMER_NAME': step5.get('customerName') or '',
        'PROJECT_NAME':  project.name or '',
        'PROPOSAL_DATE': today,
    }

    if 'quantities' in wb.sheetnames:
        _fill_sheet(wb['quantities'], 'QTY_TABLE_DATA_ROW', proposal_rows, ctx)
    if 'pricing' in wb.sheetnames:
        _fill_sheet(wb['pricing'], 'PRICE_TABLE_DATA_ROW', proposal_rows, ctx)

    # The template was authored from another workbook and ships with five
    # defined names that point at an external `[1]ראשי!#REF!` cell, plus the
    # external-link entry itself. openpyxl re-emits these into the saved
    # workbook in a shape Excel rejects ("we found a problem with some
    # content"), so strip them out before serialising.
    for name in list(wb.defined_names):
        if '#REF!' in (wb.defined_names[name].value or ''):
            del wb.defined_names[name]
    if getattr(wb, '_external_links', None):
        wb._external_links = []

    out = io.BytesIO()
    wb.save(out)
    return _restore_header_footer_images(TEMPLATE_PATH.read_bytes(), out.getvalue())


# ───────────────────────────────────────────────────────────────────────
# Header/footer image restoration (post-openpyxl-save)
# ───────────────────────────────────────────────────────────────────────

# openpyxl reads & re-emits the worksheet's `<headerFooter><oddHeader>&C&G…`
# placeholder text but drops everything else needed to make the print-time
# logo + footer image actually render: the VML drawing files at
# xl/drawings/vmlDrawing*.vml, the image media files, the per-sheet
# relationship to the VML drawing, and the `<legacyDrawingHF r:id="…"/>`
# element inside each worksheet. Without all four, Excel finds nothing for
# `&G` to point at and prints a blank header/footer.
#
# The fix: after openpyxl's serializer runs, copy the missing parts from the
# original template zip into the output zip (matching by sheet name so the
# right VML lands on the right sheet), and patch each output sheet's XML +
# rels to re-link them.

_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
_MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
_R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def _parse_workbook_sheets(xml_bytes: bytes) -> list[tuple[str, str]]:
    """Return [(sheet_name, r:id), …] in order from a workbook.xml."""
    root = ET.fromstring(xml_bytes)
    out = []
    for s in root.iter(f'{{{_MAIN_NS}}}sheet'):
        out.append((s.attrib['name'], s.attrib[f'{{{_R_NS}}}id']))
    return out


def _parse_rels(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    return [dict(r.attrib) for r in root.iter(f'{{{_REL_NS}}}Relationship')]


def _restore_header_footer_images(template_bytes: bytes, output_bytes: bytes) -> bytes:
    template_files: dict[str, bytes] = {}
    with ZipFile(io.BytesIO(template_bytes), 'r') as tz:
        for name in tz.namelist():
            template_files[name] = tz.read(name)
    output_files: dict[str, bytes] = {}
    with ZipFile(io.BytesIO(output_bytes), 'r') as oz:
        for name in oz.namelist():
            output_files[name] = oz.read(name)

    # 1. Copy every VML drawing + its .rels and every image media file from
    #    the template that the output is missing.
    for name in template_files:
        if (
            name.startswith('xl/drawings/vmlDrawing')
            or name.startswith('xl/drawings/_rels/vmlDrawing')
            or name.startswith('xl/media/')
        ) and name not in output_files:
            output_files[name] = template_files[name]

    # 2. Map sheet names → file paths in both workbooks (needed so we patch
    #    the *same logical sheet* even if openpyxl reordered or renumbered
    #    sheetN.xml on save).
    template_sheets = _parse_workbook_sheets(template_files['xl/workbook.xml'])
    output_sheets = _parse_workbook_sheets(output_files['xl/workbook.xml'])

    template_wb_rels = {r['Id']: r['Target'] for r in _parse_rels(template_files['xl/_rels/workbook.xml.rels'])}
    output_wb_rels = {r['Id']: r['Target'] for r in _parse_rels(output_files['xl/_rels/workbook.xml.rels'])}

    template_sheet_path = {name: template_wb_rels[rid] for name, rid in template_sheets if rid in template_wb_rels}
    output_sheet_path = {name: output_wb_rels[rid] for name, rid in output_sheets if rid in output_wb_rels}

    def _norm(p: str) -> str:
        return p[1:] if p.startswith('/') else ('xl/' + p if not p.startswith('xl/') else p)

    # 3. For each shared sheet, find the template's legacyDrawingHF target
    #    (the VML drawing it pointed at) and re-link the output sheet to the
    #    same VML drawing path.
    for sheet_name, t_path in template_sheet_path.items():
        if sheet_name not in output_sheet_path:
            continue
        t_sheet = _norm(t_path)
        o_sheet = _norm(output_sheet_path[sheet_name])
        t_rels_path = t_sheet.replace('worksheets/', 'worksheets/_rels/') + '.rels'
        o_rels_path = o_sheet.replace('worksheets/', 'worksheets/_rels/') + '.rels'
        if t_rels_path not in template_files:
            continue

        # Find the VML drawing the template's sheet points at.
        legacy_target = None
        for r in _parse_rels(template_files[t_rels_path]):
            if r.get('Type', '').endswith('/vmlDrawing'):
                legacy_target = r['Target']
                break
        if legacy_target is None:
            continue

        # Pick a relationship id that doesn't collide with output's existing rels.
        existing = _parse_rels(output_files.get(o_rels_path, b'<?xml version="1.0"?><Relationships xmlns="' + _REL_NS.encode() + b'"/>'))
        used_ids = {r['Id'] for r in existing}
        new_rid = next(f'rId{i}' for i in range(100, 999) if f'rId{i}' not in used_ids)

        # Inject the relationship into the output sheet's .rels.
        rels_xml = output_files[o_rels_path].decode('utf-8') if o_rels_path in output_files else (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{_REL_NS}"></Relationships>'
        )
        new_rel = (
            f'<Relationship Id="{new_rid}" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" '
            f'Target="{legacy_target}"/>'
        )
        rels_xml = rels_xml.replace('</Relationships>', new_rel + '</Relationships>')
        output_files[o_rels_path] = rels_xml.encode('utf-8')

        # Inject <legacyDrawingHF r:id="…"/> into the output sheet XML, just
        # before the closing </worksheet> tag (or before <tableParts> if
        # present, since legacyDrawingHF must come after most child elements
        # but before the last few). Excel is forgiving about the exact spot;
        # placing it just before </worksheet> works.
        sheet_xml = output_files[o_sheet].decode('utf-8')
        if '<legacyDrawingHF' not in sheet_xml:
            # Declare the `r` prefix on the element itself — openpyxl emits it
            # only on `<tablePart>` so it isn't bound at the worksheet root.
            # Per the OOXML schema, `legacyDrawingHF` must come BEFORE
            # `tableParts` in the worksheet element ordering, otherwise Excel
            # rejects the file.
            tag = f'<legacyDrawingHF xmlns:r="{_R_NS}" r:id="{new_rid}"/>'
            if '<tableParts' in sheet_xml:
                sheet_xml = sheet_xml.replace('<tableParts', tag + '<tableParts', 1)
            else:
                sheet_xml = sheet_xml.replace('</worksheet>', tag + '</worksheet>')
            output_files[o_sheet] = sheet_xml.encode('utf-8')

    # 4. Make sure [Content_Types].xml registers the VML and PNG content
    #    types — openpyxl drops them when there's nothing in its model that
    #    needs them.
    ct_path = '[Content_Types].xml'
    if ct_path in output_files:
        ct = output_files[ct_path].decode('utf-8')
        added = []
        if 'ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"' not in ct:
            added.append('<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>')
        if 'Extension="png"' not in ct:
            added.append('<Default Extension="png" ContentType="image/png"/>')
        if added:
            ct = ct.replace('<Types ', ''.join(added).join(['<Types ', ' ']), 1) if False else \
                 ct.replace('</Types>', ''.join(added) + '</Types>')
            output_files[ct_path] = ct.encode('utf-8')

    # 5. Re-zip.
    buf = io.BytesIO()
    with ZipFile(buf, 'w', ZIP_DEFLATED) as out_zip:
        for name, data in output_files.items():
            out_zip.writestr(name, data)
    return buf.getvalue()
