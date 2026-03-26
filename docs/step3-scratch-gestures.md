# Step 3 — Scratch Mode Gestures

> **Keep this file up to date** whenever scratch-mode interaction changes in `PanelCanvas.jsx`.
> Linked from [README.md](../README.md).

---

## Legend

| Symbol | Meaning |
|---|---|
| ✓ | Implemented and manually verified |
| — | Not yet verified |

---

## Gestures Table

| # | Mode | Trigger | Behaviour | Verified |
|---|---|---|---|---|
| 1 | Free | Hover over draggable corner | `crosshair` cursor on corner circle | ✓ |
| 2 | Free | Pivot corner (v[0]) | Non-interactive (`pointerEvents:none`), default cursor | ✓ |
| 3 | Free | Corner mousedown → drag | Projects mouse onto local width/height axes; v[1]=width only, v[2]=both, v[3]=height only | ✓ |
| 4 | Free | Corner drag — min size | Width clamped to `pLen/px`, height clamped to `pWid/px` (fits 1 landscape panel) | ✓ |
| 5 | Free | Corner mouseup | Fit polygon tightly to placed panels; all 4 vertices update | ✓ |
| 6 | Free | Polygon outline style | Dashed border | ✓ |
| 7 | Y-lock | Pivot corner (v[0]) | `move` cursor; interactive; dragging translates entire area | ✓ |
| 8 | Y-lock | Pivot corner mousedown → drag | All vertices translated by `(mouseX − v.x, mouseY − v.y)`; no jump (vertex used as start anchor) | ✓ |
| 9 | Y-lock | Pivot corner mouseup | Fit polygon to panels; same as other drags | ✓ |
| 10 | Y-lock | Non-pivot corner cursor | `ns-resize` | ✓ |
| 11 | Y-lock | Hover inside polygon body | `ns-resize` cursor on SVG | ✓ |
| 12 | Y-lock | Body mousedown → drag Y | Rigid-body rotation via `atan2(deltaY, refLength)`, pivot fixed | ✓ |
| 13 | Y-lock | Corner mousedown → drag Y | Rotation: corner Y tracks mouse, X from `sqrt(dist²−dy²)` | ✓ |
| 14 | Y-lock | Corner mousedown → drag X | Width extends via projection onto rotated local X axis; height locked | ✓ |
| 15 | Y-lock | Corner drag — min width | Width clamped to `pLen/px` (fits 1 landscape panel) | ✓ |
| 16 | Y-lock | \|rotation\| < 10° during drag | Dashed yellow guide line at pivot Y, spanning bbox width | ✓ |
| 17 | Y-lock | \|rotation\| < 3° during drag | Auto-snap to 0°; guide turns solid green | ✓ |
| 18 | Y-lock | Corner/body mouseup | Fit polygon to panels using SAT-correct rotated corners | ✓ |
| 19 | Y-lock | Polygon outline style | Solid border + ⊟ label suffix | ✓ |
| 20 | Both | Mode toggle (🔓/🔒) in sidebar | Flat grayscale SVG lock icon; flips `'free'` ↔ `'ylocked'`, geometry preserved; selects area | ✓ |
| 21 | Both | Draw tool drag | Live rect preview; `xDir`/`yDir` from drag direction | ✓ |
| 22 | Both | Draw mouseup | `fitPolygonToRectPanels` → stores polygon with `xDir`, `yDir`, `pivotIdx:0` | ✓ |
| 23 | Both | New area created | Newly drawn area is auto-selected immediately after panel compute | ✓ |
| 24 | Both | Delete button (✕) in sidebar | Removes area; auto-selects next area (or previous if last) | ✓ |
| 25 | Both | Regenerate button (↺) in sidebar | Recomputes panels for that area only, geometry unchanged; selects area | ✓ |
| 26 | Both | `xDir` panel ordering | `computePolygonPanels` fills panels in draw direction (`ltr`/`rtl`) | ✓ |
| 27 | Both | Panel slope indicator | White V▼ (below badge) or ^▲ (above badge) chevron in panel local frame; stroke matches badge fill | ✓ |
| 28 | Both | Panel type selector | Dropdown below header; changing triggers recompute via `panelSpec` | ✓ |
| 29 | Both | Default mounting section | Front H and Angle global defaults below panel type; new areas inherit these values | ✓ |
| 30 | Both | Apply to All Areas button | Pushes current Front H + Angle defaults to every `rectArea` | ✓ |
| 31 | Both | Collision — new area, fully blocked | OBB-OBB SAT; area auto-deleted | ✓ |
| 32 | Both | Collision — new area, partially blocked | Area kept with unblocked panels only | ✓ |
| 33 | Both | Collision — existing area, all blocked | Area kept; at least `computed[0]` preserved | ✓ |
| 34 | Both | Collision — existing area, partially blocked | Area kept with unblocked panels only | ✓ |
| 35 | Both | Sidebar area click | Selects area; only corners of selected area respond to mouse (`pointerEvents:none` on others) | ✓ |
| 36 | Both | Y-lock body drag — selection gate | Body click+drag only starts rotation if the area is currently selected | ✓ |
| 37 | Both | Auto-select single area | When exactly 1 area exists and nothing is selected, all its panels are auto-selected | ✓ |
| 38 | Both | Selection sync after recompute | `selectedAreaIdxRef` (stable integer) used to re-derive panel IDs after every recompute | ✓ |
| 39 | Both | Rect-select restricted to one area | Drag selection picks the most-represented area only | ✓ |
| 40 | Both | Z-order — selected area | Active/selected area's corners always render on top of all other areas | ✓ |

---

## Related files

| File | Role |
|---|---|
| `FE/src/components/steps/step3/PanelCanvas.jsx` | All gesture handling, SVG rendering, panel badge + chevron |
| `FE/src/utils/rectPanelService.js` | `computePolygonPanels`, `fitPolygonToRectPanels` |
| `FE/src/hooks/useProjectState.js` | `computeScratchPanels`, collision detection |
| `FE/src/components/steps/step3/RowSidebar.jsx` | Mode toggle (lock icon), delete, regenerate, panel type, default mounting |
| `FE/src/components/steps/Step3PanelPlacement.jsx` | Auto-select logic, `selectedAreaIdxRef`, `handleDeleteArea` |
| `FE/src/data/panelTypes.js` | Panel type definitions (`PANEL_TYPES`, `DEFAULT_PANEL_TYPE`) |
