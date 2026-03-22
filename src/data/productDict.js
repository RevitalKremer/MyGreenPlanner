// Product dictionary — synced from public/product-dict.csv (active=1 rows only)
// To update: edit the CSV, then sync active rows here.
// extraPct: default waste/buffer percentage from CSV "extra" column
//
// Note: angle_profile_40x40_diag is a code-level split of angle_profile_40x40
// used in BOM calculations (diagonal braces vs frame rails) — not in CSV.

export const PRODUCT_DICT = [
  { type: 'angle_profile_40x40',           pn: '', name: 'Angle Profile 40X40 mm',         extraPct: 0  },
  { type: 'angle_profile_40x40_diag',      pn: '', name: 'Angle Profile 40X40 mm (diagonal brace)', extraPct: 0  },
  { type: 'rail_40x40',                    pn: '', name: 'Rail Profile 40X40 mm',            extraPct: 0  },
  { type: 'block_50x24x15',               pn: '', name: 'Block (50*24*15)',                  extraPct: 0  },
  { type: 'bitumen_sheets',               pn: '', name: 'Bitumen Sheets',                    extraPct: 0  },
  { type: 'jumbo_5x16',                   pn: '', name: 'Jumbo 5*16',                        extraPct: 10 },
  { type: 'end_panel_clamp',              pn: '', name: 'End Panel Clamp',                   extraPct: 10 },
  { type: 'rail_end_cap',                 pn: '', name: 'Rail End Cap',                      extraPct: 10 },
  { type: 'mid_panel_clamp',              pn: '', name: 'Mid Panel Clamp',                   extraPct: 10 },
  { type: 'grounding_panel_clamp',        pn: '', name: 'Grounding Panel Clamp',             extraPct: 10 },
  { type: 'rail_connector',               pn: '', name: 'Rail Connector',                    extraPct: 10 },
  { type: 'hex_head_bolt_m8x20',          pn: '', name: 'Hex Head Bolt M8*20',               extraPct: 10 },
  { type: 'flange_nut_m8_stainless_steel',pn: '', name: 'Flange Nut M8 Stainless Steel',     extraPct: 10 },
]

// Lookup by type
export const productByType = Object.fromEntries(PRODUCT_DICT.map(p => [p.type, p]))
