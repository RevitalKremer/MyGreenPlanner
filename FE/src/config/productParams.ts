// ─────────────────────────────────────────────────────────────────────────────
// Product `params` catalog — the single source of truth for every key stored in
// a product's free-form `params` JSON, and the documentation of what each means.
//
// It powers the admin params editor (ParamsTable): only catalog keys can be
// added (scoped per product_type), values are type-coerced, and `select` keys
// render as dropdowns. Keys flagged `dedicated` are documented here but managed
// by their own form fields (e.g. panel Length/Width/Wp), so they are NOT offered
// in the table's add-list.
//
// The backend (electrical_service.py) reads these tolerantly and is NOT enforced
// by this catalog — keep the two in sync by hand when adding a key.
// ─────────────────────────────────────────────────────────────────────────────

export type ParamType = 'number' | 'select' | 'string'

export interface ParamDef {
  key: string
  label: string
  unit?: string
  type: ParamType
  products: string[]          // product_type values this key applies to
  options?: string[]          // for type 'select'
  default?: number | string
  required?: boolean          // required by the string engine / forms
  dedicated?: boolean         // has its own form field; hidden from the table
  help?: string
}

export const PARAM_CATALOG: ParamDef[] = [
  // ── Panel: physical (dedicated form fields) ──
  { key: 'Wp',       label: 'Peak power',  unit: 'W',  type: 'number', products: ['panel'], required: true, dedicated: true, help: 'Rated watts per panel; drives total DC kWp.' },
  { key: 'lengthCm', label: 'Length',      unit: 'cm', type: 'number', products: ['panel'], required: true, dedicated: true, help: 'Panel physical length.' },
  { key: 'widthCm',  label: 'Width',       unit: 'cm', type: 'number', products: ['panel'], required: true, dedicated: true, help: 'Panel physical width.' },

  // ── Panel: electrical (string engine) ──
  { key: 'Voc', label: 'Voc', unit: 'V', type: 'number', products: ['panel'], required: true, help: 'Open-circuit voltage — cold-Voc string-window check.' },
  { key: 'Vmp', label: 'Vmp', unit: 'V', type: 'number', products: ['panel'], required: true, help: 'Max-power voltage — hot-Vmp string-window check.' },
  { key: 'Isc', label: 'Isc', unit: 'A', type: 'number', products: ['panel'], required: true, help: 'Short-circuit current — string current vs MPPT input limit.' },
  { key: 'Imp', label: 'Imp', unit: 'A', type: 'number', products: ['panel'], required: true, help: 'Max-power current.' },
  { key: 'tempCoeffVocPctPerC', label: 'Voc temp coeff', unit: '%/°C', type: 'number', products: ['panel'], help: 'Negative. Defaults to −0.27 if blank.' },
  { key: 'tempCoeffVmpPctPerC', label: 'Vmp temp coeff', unit: '%/°C', type: 'number', products: ['panel'], help: 'Negative. Defaults to −0.35 if blank.' },

  // ── Inverter ──
  { key: 'acPowerKw',        label: 'AC power',        unit: 'kW', type: 'number', products: ['inverter'], required: true, help: 'Rated AC output — AC/DC ratio and auto-sizing.' },
  { key: 'mpptCount',        label: 'MPPT inputs',     unit: '',   type: 'number', products: ['inverter'], default: 1, help: 'Number of independent MPPT inputs (A, B, C…).' },
  { key: 'maxStringsPerMppt', label: 'Strings / MPPT', unit: '',   type: 'number', products: ['inverter'], default: 1, help: 'How many strings may share one MPPT input.' },
  { key: 'mpptVmin',         label: 'MPPT Vmin',       unit: 'V',  type: 'number', products: ['inverter'], required: true, help: 'MPPT window low bound (hot-Vmp check).' },
  { key: 'mpptVmax',         label: 'MPPT Vmax',       unit: 'V',  type: 'number', products: ['inverter'], required: true, help: 'MPPT window high bound (cold-Voc check).' },
  { key: 'maxInputCurrentA', label: 'Max input current', unit: 'A', type: 'number', products: ['inverter'], required: true, help: 'Per-MPPT-input current limit.' },
  { key: 'maxSystemVoltageV', label: 'Max system voltage', unit: 'V', type: 'number', products: ['inverter'], help: 'Hard string-voltage ceiling (min with MPPT Vmax).' },
  { key: 'maxDcPowerW',      label: 'Max DC power',    unit: 'W',  type: 'number', products: ['inverter'], help: 'Maximum DC input power.' },
  { key: 'maxEfficiencyPct', label: 'Max efficiency',  unit: '%',  type: 'number', products: ['inverter'], help: 'Datasheet value (informational).' },
  { key: 'dcAcRatio',        label: 'DC/AC ratio',     unit: '',   type: 'number', products: ['inverter'], help: 'Datasheet value (informational).' },

  // ── Shared (inverter + battery): connection category ──
  { key: 'productCategory', label: 'Category', type: 'select', products: ['inverter', 'battery'],
    options: ['ongrid', 'offgrid', 'hybrid'], help: 'Connection type; filters the equipment lists in Step 6.' },
]

export const catalogFor = (productType: string) => PARAM_CATALOG.filter(d => d.products.includes(productType))
export const catalogEntry = (key: string) => PARAM_CATALOG.find(d => d.key === key)

// Drop keys with empty / null / NaN values before persisting params.
export function cleanParams(obj: Record<string, any> | null | undefined) {
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === '' || v === null || v === undefined) continue
    if (typeof v === 'number' && Number.isNaN(v)) continue
    out[k] = v
  }
  return out
}
