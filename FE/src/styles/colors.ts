// ── Brand ──────────────────────────────────────────────────────────────────
export const PRIMARY      = '#C4D600'  // brand green-yellow
export const PRIMARY_DARK = '#5a6600'  // dark brand
export const PRIMARY_MID  = '#8a9a00'  // mid brand
export const PRIMARY_BG   = '#f8fce8'  // very light brand bg
export const PRIMARY_BG_ALT   = '#e8f2b0' // light brand bg
export const PRIMARY_BG_LIGHT = '#f4f9e4' // lightest brand tint

// ── Blue / Active ─────────────────────────────────────────────────────────
export const BLUE          = '#1565C0' // info / active blue
export const BLUE_SELECTED = '#0056b3' // selected / highlighted
export const BLUE_BG       = '#E3F2FD' // light blue background
export const BLUE_BORDER   = '#90CAF9' // blue border

// ── Text scale ────────────────────────────────────────────────────────────
export const TEXT_DARKEST     = '#222'  // very dark text
export const TEXT             = '#333'  // primary text
export const TEXT_DARK        = '#444'  // dark secondary text
export const TEXT_SECONDARY   = '#555'  // secondary text
export const TEXT_MUTED       = '#666'  // muted text
export const TEXT_FAINT       = '#777'  // faint text
export const TEXT_PLACEHOLDER = '#888'  // placeholder / dim label
export const TEXT_LIGHT       = '#999'  // light text
export const TEXT_VERY_LIGHT  = '#aaa'  // very light text
export const TEXT_FAINTEST    = '#bbb'  // faintest text

// ── Borders ───────────────────────────────────────────────────────────────
export const BORDER       = '#ddd'     // standard border
export const BORDER_MID   = '#ccc'     // mid border
export const BORDER_LIGHT = '#e0e0e0'  // light border
export const BORDER_FAINT = '#e8e8e8'  // faint divider / separator

// ── Backgrounds ───────────────────────────────────────────────────────────
export const BG_FAINT  = '#fafafa'  // near-white background
export const BG_LIGHT  = '#f8f9fa'  // light background
export const BG_SUBTLE = '#f5f5f5'  // subtle background
export const BG_MID    = '#f0f0f0'  // mid background
export const WHITE     = '#fff'
export const BLACK     = '#000'
export const WHITE_10  = 'rgba(255,255,255,0.1)'  // white divider on dark bg
export const WHITE_20  = 'rgba(255,255,255,0.2)'  // subtle white border on dark bg
export const WHITE_40  = 'rgba(255,255,255,0.4)'  // faint white text on dark bg
export const WHITE_50  = 'rgba(255,255,255,0.5)'  // muted white text on dark bg
export const WHITE_75  = 'rgba(255,255,255,0.75)' // secondary white text on dark bg
export const WHITE_90  = 'rgba(255,255,255,0.9)'  // primary white text on dark bg
export const BLACK_35  = 'rgba(0,0,0,0.35)'       // faint dark text on light bg

// ── Modal scrim / shadow (shared overlay tokens) ─────────────────────────
// Scrim sits behind centered modal cards; shadow is the rgba portion of the
// box-shadow drop applied to the card. Reuse across all overlay components.
export const MODAL_SCRIM    = 'rgba(0,0,0,0.45)'
export const MODAL_SHADOW   = 'rgba(0,0,0,0.2)'

// ── Warning / Orange ─────────────────────────────────────────────────────
export const WARNING       = '#FF9800'  // warning orange
export const WARNING_DARK  = '#E65100'  // dark warning
export const WARNING_LIGHT = '#FFB74D'  // light orange
export const WARNING_BG    = '#FFF3E0'  // warning background
export const AMBER         = '#FFB300'  // amber
export const AMBER_DARK    = '#b45309'  // dark amber

// ── Success / Green ───────────────────────────────────────────────────────
export const SUCCESS      = '#4CAF50'  // success green
export const SUCCESS_DARK = '#1B5E20'  // dark success green
export const SUCCESS_BG   = '#E8F5E9'  // light green background

// ── Error / Red ───────────────────────────────────────────────────────────
export const ERROR      = '#f44336'  // error red
export const ERROR_DARK = '#c0392b'  // dark error red
export const ERROR_BG   = '#fdecea'  // error background

// ── Ghost / inactive zone ─────────────────────────────────────────────────
export const GHOST_FILL   = 'white'   // fill for ghosted structural elements
export const GHOST_STROKE = 'gray'    // border for ghosted structural elements
export const GHOST_DASH   = '4,3'    // stroke-dasharray for ghost style

// ── Structural beams / blocks ─────────────────────────────────────────────
// ── Functional-semantic schema tokens ──────────────────────────────────────
// Color encodes a part's ROLE, not decoration, and is shared across all Step-3
// tabs so the same physical element looks identical everywhere. Canonical
// tokens are defined first; the per-view names below are aliased onto them.
//
//   static structure (beams/legs)  → one neutral steel gray
//   concrete blocks                → one light concrete gray
//   cross-rails                    → anodized slate blue-gray
//   diagonals (height indicator)   → teal
//   connectors / joints            → purple (one color, one shape)

// Static metal — beams, legs (translucent so overlapping rails/dims read through).
export const STRUCT_FILL    = '#8d8d8d99'  // neutral steel gray fill
export const STRUCT_STROKE  = '#5c5c5c'    // neutral steel gray stroke

// Concrete blocks — light, warm-neutral; deliberately lighter than the metal
// structure so a block sitting on a beam stays legible.
export const BLOCK_FILL        = '#bdbab2'  // concrete block fill
export const BLOCK_STROKE      = '#8a8780'  // concrete block stroke

// External diagonal (Bases plan) — blueish height indicator, distinct from the
// gray structural members and visible over the panel hatching. (Internal trap
// bracing diagonals are NOT this color — they share the structural gray.)
export const DIAGONAL_STROKE = '#0277bd'  // external diagonal line — blue
export const DIAGONAL_LABEL  = '#01406e'  // external diagonal label text — dark blue (stands out on translucent-white bg)

// Connectors — single purple joint marker for every splice/stock junction.
export const CONNECTOR_FILL   = '#7c3aed55'  // joint marker fill — purple
export const CONNECTOR_STROKE = '#5b21b6'    // joint marker stroke — purple

// ── Cross-rails ───────────────────────────────────────────────────────────
// Red-brown coated profile — kept clear of the PV-blue panels and the gray structure.
export const RAIL_FILL = '#a0533f'  // cross-rail fill — red-brown
export const RAIL_STROKE       = '#6e3324'  // cross-rail stroke — dark red-brown
export const RAIL_STROKE_HOVER = '#c07a64'  // rail stroke on hover (lighter red-brown)
// (rail stock connectors now use the unified CONNECTOR_* tokens — see RailsOverlay)

// ── Panel bars (detail cross-section) ───────────────────────────────────────
// Re-tinted into the PV-blue panel family so they no longer clash with the
// connector purple.
export const PANEL_BAR_FILL   = '#7fa8d0'  // panel bar fill — PV blue
export const PANEL_BAR_STROKE = '#3a6ea5'  // panel bar stroke — PV blue (== PANEL_STROKE_MID)

// ── Per-view aliases → canonical schema tokens ──────────────────────────────
// Keep existing import names working while unifying the underlying values.
export const TRAP_BLOCK_FILL        = BLOCK_FILL       // detail concrete block fill
export const TRAP_BLOCK_STROKE      = BLOCK_STROKE     // detail concrete block stroke
export const TRAP_L_PROFILE_FILL    = STRUCT_FILL      // detail main beam fill
export const TRAP_L_PROFILE_STROKE  = STRUCT_STROKE    // detail main beam stroke
export const L_PROFILE_FILL         = STRUCT_FILL      // plan base/slope beam fill
export const L_PROFILE_STROKE       = STRUCT_STROKE    // plan base/slope beam stroke
export const BEAM_CONNECTOR_FILL    = CONNECTOR_FILL   // splice connector marker fill
export const BEAM_CONNECTOR_STROKE  = CONNECTOR_STROKE // splice connector marker stroke

// ── Punch bar ─────────────────────────────────────────────────────────────
export const PUNCH_BAR_FILL   = '#d8d8d8'  // punch sketch bar fill
export const PUNCH_BAR_STROKE = '#999'     // punch sketch bar stroke

// ── Interaction states ────────────────────────────────────────────────────
export const DANGER        = '#dc2626'    // delete / danger action
export const ADD_GREEN     = '#22c55e'    // add / success indicator
export const ADD_GREEN_BG  = '#f0fdf4'    // light green tint for added rows

// ── Roof type / installation method overlay ──────────────────────────────
export const ROOF_CONCRETE         = '#3e3e3e'   // gray — concrete roof
export const ROOF_TILES            = '#c0392b'   // tile red — tiles roof
export const ROOF_FLAT_INSTALLATION = '#ddd6fe'  // pale purple — flat installation (sandwich_roof_accessory)
export const ROOF_CORRUGATED       = '#bdbdbd'   // light gray — iskurit / insulated panel
export const OMEGA_PURPLE          = '#ddd6fe'   // pale purple — omega anchor circles

// ── Area overlay palette (AreasTab polygons) ─────────────────────────────
export const AREA_PALETTE = ['#5fa8e0', '#5ec89a', '#e09455', '#a855d4', '#d4c832', '#32c8c8', '#e05f8a', '#8ae05f']

// ── Panel layout colors ───────────────────────────────────────────────────
export const PANEL_LIGHT_BG      = '#cfe3f5'           // unselected panel fill
export const PANEL_LIGHT_BG_ALT  = '#d1e3f3'           // selected panel fill
export const PANEL_DARK          = '#003e7e'            // panel dark border (selected)
export const PANEL_MID           = '#4682B4'            // panel mid border (unselected)
export const PANEL_STROKE_MID    = '#3a6ea5'            // panel stroke mid (RowsView rect)
export const PANEL_STROKE_FAINT  = '#9bbcd4'            // panel hatch stroke
export const GRIDLINE_AREA       = '#a0a0a04d'          // area gridline color (canvas step 2)
// Panel canvas fill states
export const PANEL_FILL              = 'rgba(135,206,235,0.35)'  // normal panel fill
export const PANEL_FILL_SELECTED     = 'rgba(0,62,126,0.18)'     // selected panel fill
export const PANEL_FILL_HOVER_DELETE = 'rgba(244,67,54,0.65)'    // delete-hover panel fill
export const PANEL_FILL_HOVER_ROTATE = 'rgba(33,150,243,0.45)'   // rotate-hover panel fill
// Panel canvas badge states
export const PANEL_BADGE_DEFAULT  = 'rgba(15,15,15,0.55)'  // trapezoid badge bg (normal)
export const PANEL_BADGE_SELECTED = 'rgba(15,15,15,0.62)'  // slope chevron bg (normal)
export const PANEL_BADGE_SEL_FILL = 'rgba(0,62,126,0.82)'  // trapezoid badge bg (selected)
export const PANEL_BADGE_SEL_CHV  = 'rgba(0,62,126,0.9)'   // slope chevron bg (selected)
// Panel minimap
export const PANEL_MINI_DEFAULT  = 'rgba(70,130,180,0.55)' // minimap panel fill (normal)
export const PANEL_MINI_SELECTED = 'rgba(0,62,126,0.7)'    // minimap panel fill (selected)

// ── Drawing / arrows ──────────────────────────────────────────────────────
export const DRAW_COLOR  = '#FF00FF'  // freehand draw color / baseline color
export const ARROW_COLOR = '#666666'  // dimension arrow color — neutral gray (annotations stay quiet)
// Canvas overlays
export const CANVAS_MASK        = 'rgba(0,0,0,0.6)'     // dark mask over roof polygon area
export const CANVAS_MINI_BG     = 'rgba(0,0,0,0.25)'    // minimap dark background
export const CANVAS_AREA_HOVER  = 'rgba(255,200,0,0.06)' // draw-rect area hover tint
export const CANVAS_SEL_FILL    = 'rgba(100,160,255,0.10)' // rectangle selection fill
export const CANVAS_SEL_STROKE  = '#3399FF'              // rectangle selection stroke
export const CANVAS_LABEL_BG    = 'rgba(15,15,15,0.78)'  // distance ruler label background
export const CANVAS_LABEL_TEXT  = 'rgba(255,255,255,0.55)' // distance ruler secondary text
export const CANVAS_DELETE_MARK = 'rgba(200,0,0,0.75)'   // delete cross marker fill

// ── Layers panel ──────────────────────────────────────────────────────────
export const LAYER_ACCENT = '#2b6a99'  // checkbox accent in LayersPanel

// ── Amber UI (buttons / resets) ───────────────────────────────────────────
export const AMBER_BG     = '#fffbeb'  // amber button background
export const AMBER_BORDER = '#fcd34d'  // amber button border

// ── Structural / SVG ─────────────────────────────────────────────────────
export const GROUND_LINE  = '#123812'  // floor/ground line green

// ── Chart / widget backgrounds ────────────────────────────────────────────
export const CHART_BG     = '#e8f0f8'  // chart/ruler background
export const CHART_GRID   = '#b0c4d8'  // chart grid lines
export const CHART_BG_ALT = '#f0f4f8'  // chart alternate background

// ── PDF preview canvas ────────────────────────────────────────────────────
export const PDF_CANVAS_BG     = '#c8d4e0'  // PDF preview area background
export const PDF_CANVAS_BG_ALT = '#bfcbd8'  // PDF canvas dot pattern color

// ── Sidebar / navigation ──────────────────────────────────────────────────
export const TAB_ACTIVE_COLOR  = '#d97706'  // active tab text
export const ROW_SELECTED_BG   = '#edf5d8'  // selected row background
export const TRAP_BADGE_BG     = '#ddeea0'  // trapezoid badge background
export const SECTION_HEADER_BG = '#f0f4e8'  // section header background

// ── Credits ledger row backgrounds (admin CreditsTab) ────────────────────
// One pastel tint per ledger transaction kind, chosen so the kind chip is
// readable at a glance against the table row background.
export const LEDGER_TRIAL_BG    = '#F1F8E9'  // trial grant — pale green
export const LEDGER_GRANT_BG    = '#E3F2FD'  // admin_grant — pale blue
export const LEDGER_REFUND_BG   = '#FFF3E0'  // admin_refund — pale orange
export const LEDGER_PURCHASE_BG = '#F3E5F5'  // purchase — pale purple
export const LEDGER_CHARGE_BG   = '#FCE4EC'  // project_charge — pale pink
