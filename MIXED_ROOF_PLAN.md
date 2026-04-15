# Step 2 Areas Reorg: Per-Area Roof Type + Area Management UX

## Context

Currently `projects.roof_spec` is project-level — one roof type for all areas. The user needs:
1. **Mixed roof support**: different areas can have different roof types (concrete, tiles, iskurit, insulated_panel)
2. **Remove angle/height merge restriction**: rows with different angles can be grouped into one area (angle/height become per-trapezoid)
3. **Better area management UX**: multi-select rows to group into an area

## Data Model

**Project-level discriminator**: `projects.roof_spec = {"type": "mixed"}` (no global purlin params)
**Per-area storage**: `data.step2.areas[].roofSpec = {"type": "concrete|tiles|iskurit|insulated_panel", "distanceBetweenPurlinsCm": ..., "installationOrientation": ...}`

**Resolution helper** (new, in `BE/mgp-service/app/utils/settings_helpers.py`):
```python
def resolve_roof_spec(project_roof_spec: dict, area: dict) -> dict:
    if project_roof_spec.get('type') != 'mixed':
        return project_roof_spec
    return area.get('roofSpec') or {'type': 'concrete'}
```
All ~15 callsites that read `project.roof_spec` directly get replaced with this.

---

## Phase 1: Backend — per-area roof resolution (no FE changes)

Backward-compatible: non-mixed projects unchanged.

### 1a. Schema updates
- `BE/mgp-service/app/schemas/roof_spec.py` — add `'mixed'` to Literal type
- `BE/mgp-service/app/schemas/project_data.py` — add `roofSpec: Optional[dict] = None` to `Step2Area`

### 1b. Add `resolve_roof_spec` helper
- `BE/mgp-service/app/utils/settings_helpers.py`

### 1c. Service changes (per-area roof resolution)

| Service | File | Current | Change |
|---------|------|---------|--------|
| Bases | `projects.py` (`compute_and_save_bases`) | Global tiles skip at top | Per-area: skip only tile areas, compute others |
| Bases | `projects.py` (`_compute_row_bases`) | Single `roof_spec` param | Resolve per-area before passing to `compute_area_bases` |
| Trap details | `projects.py` (`compute_and_save_trapezoid_details`) | Global tiles skip | Per-trap: resolve via area lookup |
| BOM | `bom_service.py` | Global `roof_type` for all rows | Per-area: set `rc['roofType']` from area's roofSpec |
| Step transition | `projects.py` (tiles angle/height zeroing) | Zero all areas if tiles | Zero only tile-typed areas |

### 1d. Migration
- `0035_add_mixed_roof_type.py` — documentation-only (JSONB is schemaless, no DDL)

---

## Phase 2: FE — mixed project creation + per-area UI

### 2a. Project creation
- `FE/src/components/WelcomeScreen.jsx` — add "Mixed" dropdown option; hide purlin params when mixed

### 2b. i18n
- `FE/src/i18n/en.js`, `he.js` — add `roofSpec.type.mixed` + per-area selector labels

### 2c. Per-area roof type display
- `FE/src/components/steps/step3/AreasTab.jsx` — per-area color coding using existing `ROOF_COLOR_MAP`

### 2d. Per-area roof type selector
- `FE/src/components/steps/step3/Step3Sidebar.jsx` — when mixed + area selected: dropdown for area's roof type + conditional purlin params

### 2e. Settings filtering
- `FE/src/hooks/useAppConfig.js` (`paramSchemaForRoof`) — for mixed: show union of all settings needed by any area's roof type

### 2f. Tab visibility
- `FE/src/components/steps/Step3ConstructionPlanning.jsx` — for mixed: show all tabs unless ALL areas are tiles

---

## Phase 3: Step 2 area creation defaults + multi-select grouping

### 3a. Default roofSpec on new areas
- `FE/src/hooks/computePanelsAction.js` — when mixed, new areas get `roofSpec: {type: 'concrete'}`

### 3b. Multi-select row grouping (new feature)
- `FE/src/components/steps/step3/Step3Sidebar.jsx` — shift/ctrl-click multi-select on rows; "Group selected" action

---

## Phase 4: Remove angle/height merge restriction

### 4a. Remove FE merge restriction
- `FE/src/components/steps/step2/RowSidebar.jsx:236` — remove `Math.abs(tAngle - thisAngle) < 0.1 && Math.abs(tFH - thisFH) < 0.1` check
- Angle/height become per-trapezoid (already supported by `step2.trapezoids[].angleDeg/frontHeightCm`)

---

## Risk Areas

1. **BOM aggregation** (Medium-High): must correctly sum different materials per roof type across areas
2. **Tiles early-exit** (Medium): 3 separate functions skip entirely for tiles — must convert to per-area skips
3. **Settings visibility** (Medium): union filter for mixed roof settings
4. **PDF report** (Low-Medium): receives single `roofType` prop, needs per-area for mixed

## Verification

- Existing non-mixed projects: full regression test (bases, rails, trapezoid details, BOM, PDF)
- New mixed project: create with 2 areas (concrete + iskurit), verify per-area computation
- BOM: verify correct screws/blocks per area type
- Multi-select: group 3 rows into area, verify correct trapezoid computation
