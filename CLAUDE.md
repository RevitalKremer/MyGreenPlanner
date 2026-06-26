# MyGreenPlanner — Developer Instructions

These instructions apply to all work in this repository. Follow them exactly.

---

## 1. Colors — All in `colors.js`

**Rule:** Every color value used in JSX or JS must be a named constant from `FE/src/styles/colors.js`. No hardcoded hex values, `rgb()`, or CSS named colors (except `transparent`) anywhere else.

- When adding a new color, first check if a similar constant already exists in `colors.js`. Reuse it or generalize it.
- If a new constant is needed, add it in the appropriate section with a clear semantic name and a comment.
- After any color-related change, grep for hardcoded hex values to verify compliance:
  ```
  grep -rn "#[0-9a-fA-F]\{3,6\}" FE/src/ --include="*.jsx" --include="*.js" --exclude="colors.js"
  ```
- Ghost style constants: `GHOST_FILL`, `GHOST_STROKE`, `GHOST_DASH` — use these for all inactive/ghosted SVG elements.

---

## 2. Step 4 Parameters — Defaults, Min/Max, Highlights

**Single source of truth:** `FE/src/components/steps/step4/constants.js` — `PARAM_SCHEMA`

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
| `FE/src/utils/railLayoutService.js` | Rail layout calc, stock splitting, coordinate transforms |
| `FE/src/utils/basePlanService.js` | Base/block placement calculations |
| `FE/src/utils/panelUtils.js` | Panel grouping, bounding box, `fmt()` formatter |
| `FE/src/utils/trapezoidGeometry.js` | Geometry helpers, panel depth constants |
| `FE/src/utils/constructionCalculator.js` | BOM and material sizing |

**Shared components** — reuse, do not recreate:

| Component | Purpose |
|---|---|
| `FE/src/components/shared/CanvasNavigator.jsx` | Pan/zoom UI controls |
| `FE/src/components/shared/MinimapView.jsx` | Minimap preview widget |
| `FE/src/components/shared/RulerTool.jsx` | Distance measurement tool |
| `FE/src/components/steps/step4/DimensionAnnotation.jsx` | SVG dimension-line annotation |

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
grep -rn "from '.*colors'" FE/src/ --include="*.jsx" --include="*.js"
```

---

## 5. Help Text — Keep It Up to Date

**Location:** `FE/src/components/HelpPanel.jsx` — the `HELP` object, keyed by step number.

Each step entry has:
- `title` — step name
- `purpose` — one-sentence summary of the step's goal
- `qa` — array of `{ q, a }` pairs covering the most important user questions

**Rule:** When any user-facing behavior changes (new parameter, changed workflow, renamed button, new feature), update the corresponding `HELP` entry in the same PR/commit. Help text that is out of sync with actual behavior is worse than no help text.

**Parameter-level help:** The sidebar renders a tooltip (InfoTooltip) for each parameter showing its default, min, and max. These values come from `PARAM_SCHEMA` in `constants.js` — keep them accurate.

---

## 6. Versioning

**Rule:** Bump the version **only on merge into `dev`** — not on every commit. Feature/fix branches (e.g. `bugs-and-tuning`) accumulate commits without a bump; the bump happens once, as part of the merge into `dev`. Merges from `dev` to `master` carry the same version — do **not** bump again when merging to master.

`dev` is the rolling deployment branch; each merge lands a new version. `master` is the release pointer that mirrors whatever `dev` has shipped most recently.

**Two version files (single sources of truth — keep them in sync):**

- `FE/package.json` → `"version"` (surfaced as `App: vX.Y.Z` on the welcome screen, injected at build time via `vite.config.js → define.__APP_VERSION__`)
- `BE/mgp-service/app/__version__.py` → `__version__` (surfaced as `Srv: vX.Y.Z`, served by `/version`, used as FastAPI app metadata)

Bump both to the same value so the welcome footer reads consistently.

Use [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

- `PATCH` — bug fixes, small tweaks
- `MINOR` — new features, non-breaking changes
- `MAJOR` — breaking changes or major milestones

**On merge into `dev`:**

1. Update `"version"` in `FE/package.json` AND `__version__` in `BE/mgp-service/app/__version__.py` to the new value.
2. Land the bump as part of the merge (e.g. a `chore: bump version to X.Y.Z` commit immediately before merging, or in the merge itself).

**On merge from `dev` to `master`:** no bump — master inherits dev's version.

**Do not edit hardcoded version strings elsewhere** — `FE/src/services/projectsApi.ts` reads `__APP_VERSION__` (injected from `package.json`), and `BE/mgp-service/app/main.py` imports `__version__` from `__version__.py`. Those two files are the single sources of truth.

---

## Project Structure Reference

```
FE/                                          # React frontend
├── src/
│   ├── App.jsx                              # Step router
│   ├── styles/colors.js                     # ALL color constants (source of truth)
│   ├── hooks/
│   │   └── useProjectState.js               # Global project state & localStorage
│   ├── utils/                               # Pure calculation services
│   └── components/
│       ├── shared/                          # Cross-step reusable components
│       └── steps/
│           ├── Step4ConstructionPlanning.jsx
│           └── step4/
│               ├── constants.js             # PARAM_SCHEMA, SETTINGS_DEFAULTS
│               ├── DetailView.jsx
│               ├── Step4Sidebar.jsx
│               ├── BasePlanOverlay.jsx
│               ├── BasesPlanTab.jsx
│               ├── RailLayoutTab.jsx
│               ├── HatchedPanels.jsx
│               ├── LayoutView.jsx
│               ├── RowsView.jsx
│               ├── LayersPanel.jsx
│               ├── RailCrossSectionWidget.jsx
│               ├── RailCrossSectionOverlay.jsx
│               └── DimensionAnnotation.jsx
├── public/
├── index.html
├── package.json
└── vite.config.js

BE/
├── mgp-service/                             # MyGreenPlanner API (FastAPI + PostgreSQL)
└── sam-service/                             # SAM2 image segmentation service

DevOps/                                      # All deployment files
├── docker-compose.yml
├── Dockerfile.frontend
├── Dockerfile.mgp-service
└── nginx.conf
```
