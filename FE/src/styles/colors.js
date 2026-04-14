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
export const WHITE_50  = 'rgba(255,255,255,0.5)'  // muted white text on dark bg

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
// Trapezoid cross-section (DetailView) — lighter for readability against
// dimension annotations and detail callouts.
export const TRAP_BLOCK_FILL        = '#c0c0c0'  // concrete block fill
export const TRAP_BLOCK_STROKE      = '#777'     // concrete block stroke
export const TRAP_L_PROFILE_FILL    = '#40404080'  // main beam fill
export const TRAP_L_PROFILE_STROKE  = '#606060'  // main beam stroke

// External diagonal (BasesPlanTab) — cyan for visibility over panels
export const DIAGONAL_STROKE = '#00ACC1'  // external diagonal line + fill dot
export const DIAGONAL_DOT    = '#00ACC1'  // external diagonal endpoint dot

// Bases diagram (BasesPlanTab) — darker so blocks/profiles read clearly
// against the panel hatching in top-down view.
export const BLOCK_FILL        = '#4a4a4a'  // concrete block fill
export const BLOCK_STROKE      = '#1a1a1a'  // concrete block stroke
export const L_PROFILE_FILL    = '#2a2a2a'  // main beam fill
export const L_PROFILE_STROKE  = '#1a1a1a'  // main beam stroke

// ── Panel bars ────────────────────────────────────────────────────────────
export const PANEL_BAR_FILL   = '#6a70ac'  // panel bar fill
export const PANEL_BAR_STROKE = '#293189'  // panel bar stroke

// ── Cross-rails ───────────────────────────────────────────────────────────
export const RAIL_FILL = '#7c3aed'  // cross-rail fill
export const RAIL_STROKE       = '#642165'  // secondary brand RAIL_FILL
export const RAIL_CONNECTOR    = '#00bcd4'  // cyan connector between rail stock segments

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
export const ROOF_CORRUGATED       = '#bdbdbd'   // light gray — iskurit / insulated panel

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
export const ARROW_COLOR = '#17a9cf'  // dimension arrow color
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
