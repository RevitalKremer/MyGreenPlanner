# MyGreenPlanner — Developer Instructions

These instructions apply to all work in this repository. Follow them exactly.

---

## 1. Colors — All in `colors.js`

**Rule:** Every color value used in JSX or JS must be a named constant from `src/styles/colors.js`. No hardcoded hex values, `rgb()`, or CSS named colors (except `transparent`) anywhere else.

- When adding a new color, first check if a similar constant already exists in `colors.js`. Reuse it or generalize it.
- If a new constant is needed, add it in the appropriate section with a clear semantic name and a comment.
- After any color-related change, grep for hardcoded hex values to verify compliance:
  ```
  grep -rn "#[0-9a-fA-F]\{3,6\}" src/ --include="*.jsx" --include="*.js" --exclude="colors.js"
  ```
- Ghost style constants: `GHOST_FILL`, `GHOST_STROKE`, `GHOST_DASH` — use these for all inactive/ghosted SVG elements.

---

## 2. Step 4 Parameters — Defaults, Min/Max, Highlights

**Single source of truth:** `src/components/steps/step4/constants.js` — `PARAM_SCHEMA`

Every user-facing parameter is defined there with:
- `default` — the default value (used in `SETTINGS_DEFAULTS`)
- `min` / `max` — validation bounds (enforced in sidebar and inputs)
- `highlightGroup` — maps to a diagram highlight zone in `DetailView.jsx`
- `scope`: `'global'` | `'area'` | `'trapezoid'`
- `section`: `'rails'` | `'bases'` | `'detail'`

**Three-tier settings hierarchy** (defined in `Step4ConstructionPlanning.jsx`):

| Tier | Variable | Scope | Examples |
|---|---|---|---|
| Global | `globalSettings` | Applies to all areas | `crossRailEdgeDistMm`, `stockLengths` |
| Area | `areaSettings[areaIdx]` | Per row/area | `railOverhangCm`, `blockHeightCm`, `lineRails` |
| Trapezoid | `trapezoidConfigs[trapId]` | Per trapezoid ID | `edgeOffsetMm`, `spacingMm`, `baseOverhangCm` |

**Apply-to-all functions** (in `Step4ConstructionPlanning.jsx`):
- `applySection(rowIdx, keys)` — replicate area params from one row to all rows
- `applyRailsToAllAreas()` — copy rail spacing (re-derived per area geometry)
- `applyBasesToAll()` — copy trapezoid base config to all trapezoids

**Adding or changing a parameter:**
1. Update `PARAM_SCHEMA` in `constants.js` (add default, min, max, scope, section, highlightGroup).
2. Update the sidebar control in `Step4Sidebar.jsx`.
3. Update the rendering logic in `DetailView.jsx` / `BasePlanOverlay.jsx` / etc.
4. Update the tooltip/help text in `HelpPanel.jsx` if user-facing.

---

## 3. Components and Code Reuse

**Shared utilities** — use these, do not duplicate logic:

| File | What it provides |
|---|---|
| `src/utils/railLayoutService.js` | Rail layout calc, stock splitting, coordinate transforms |
| `src/utils/basePlanService.js` | Base/block placement calculations |
| `src/utils/panelUtils.js` | Panel grouping, bounding box, `fmt()` formatter |
| `src/utils/trapezoidGeometry.js` | Geometry helpers, panel depth constants |
| `src/utils/constructionCalculator.js` | BOM and material sizing |

**Shared components** — reuse, do not recreate:

| Component | Purpose |
|---|---|
| `src/components/shared/CanvasNavigator.jsx` | Pan/zoom UI controls |
| `src/components/shared/MinimapView.jsx` | Minimap preview widget |
| `src/components/shared/RulerTool.jsx` | Distance measurement tool |
| `src/components/steps/step4/DimensionAnnotation.jsx` | SVG dimension-line annotation |

**Export style:**
- React components → `export default function ComponentName`
- Utilities and constants → named exports (`export const`, `export function`)
- No barrel `index.js` files. All imports use direct paths.

**Before creating a new component or utility:** check if existing code can be extended or composed instead.

---

## 4. Import/Export — Verify After Every Change

After any change that adds, renames, or removes an exported symbol:

1. Verify the export exists at the source file with the correct name and style (named vs default).
2. Verify all import sites reference the correct name.
3. Check that nothing was left unused (unused imports cause lint warnings and confusion).

**Common pitfalls:**
- Adding a constant to `colors.js` but forgetting to add it to the import list in the consuming file.
- Renaming a utility function without updating all call sites.
- Adding a new parameter to `PARAM_SCHEMA` / `SETTINGS_DEFAULTS` without importing it where needed.

Run a quick check after changes:
```
grep -rn "from '.*colors'" src/ --include="*.jsx" --include="*.js"
```

---

## 5. Help Text — Keep It Up to Date

**Location:** `src/components/HelpPanel.jsx` — the `HELP` object, keyed by step number.

Each step entry has:
- `title` — step name
- `purpose` — one-sentence summary of the step's goal
- `qa` — array of `{ q, a }` pairs covering the most important user questions

**Rule:** When any user-facing behavior changes (new parameter, changed workflow, renamed button, new feature), update the corresponding `HELP` entry in the same PR/commit. Help text that is out of sync with actual behavior is worse than no help text.

**Parameter-level help:** The sidebar renders a tooltip (InfoTooltip) for each parameter showing its default, min, and max. These values come from `PARAM_SCHEMA` in `constants.js` — keep them accurate.

---

## Project Structure Reference

```
src/
├── App.jsx                                  # Step router
├── styles/colors.js                         # ALL color constants (source of truth)
├── hooks/
│   └── useProjectState.js                   # Global project state & localStorage
├── utils/                                   # Pure calculation services
├── components/
│   ├── shared/                              # Cross-step reusable components
│   └── steps/
│       ├── Step4ConstructionPlanning.jsx    # Step 4 main container & settings state
│       └── step4/
│           ├── constants.js                 # PARAM_SCHEMA, SETTINGS_DEFAULTS
│           ├── DetailView.jsx               # Structural SVG detail drawing
│           ├── Step4Sidebar.jsx             # Settings panel UI
│           ├── BasePlanOverlay.jsx          # Base/block SVG overlay
│           ├── BasesPlanTab.jsx             # Bases tab layout
│           ├── RailLayoutTab.jsx            # Rail tab layout
│           ├── HatchedPanels.jsx            # Panel fill rendering
│           ├── LayoutView.jsx               # Top-level layout canvas
│           ├── RowsView.jsx                 # Row-level view
│           ├── LayersPanel.jsx              # Layer visibility controls
│           ├── RailCrossSectionWidget.jsx   # Rail cross-section diagram
│           ├── RailCrossSectionOverlay.jsx  # Rail overlay
│           └── DimensionAnnotation.jsx      # Reusable SVG dimension lines
```
