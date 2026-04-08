/**
 * Panel orientation code constants — single source of truth for panel codes.
 * 
 * Used throughout the codebase for panel grid orientation logic.
 * Matches backend constants in BE/mgp-service/app/utils/panel_geometry.py
 */

// ── Individual panel codes ────────────────────────────────────────────────────

/** Vertical/portrait panel */
export const PANEL_V = 'V'

/** Horizontal/landscape panel */
export const PANEL_H = 'H'

/** Empty vertical slot (ghost) */
export const PANEL_EV = 'EV'

/** Empty horizontal slot (ghost) */
export const PANEL_EH = 'EH'

// ── Composite constants ───────────────────────────────────────────────────────

/** Real panel codes (non-ghost) */
export const REAL_PANELS = [PANEL_V, PANEL_H]

/** Empty/ghost panel codes */
export const EMPTY_PANELS = [PANEL_EV, PANEL_EH]

/** All valid panel codes */
export const ALL_PANEL_CODES = [PANEL_V, PANEL_H, PANEL_EV, PANEL_EH]

// ── Orientation predicates ────────────────────────────────────────────────────

/**
 * Check if orientation is horizontal (H or EH).
 * @param {string} o - Orientation code
 * @returns {boolean} True if horizontal or empty horizontal
 */
export const isHorizontalOrientation = (o) =>
  o === PANEL_H || o === PANEL_EH

/**
 * Check if orientation is empty/ghost (EV or EH).
 * @param {string} o - Orientation code
 * @returns {boolean} True if empty vertical or empty horizontal
 */
export const isEmptyOrientation = (o) =>
  o === PANEL_EV || o === PANEL_EH
