import { catalogFor, catalogEntry } from '../../config/productParams'
import { TEXT, TEXT_SECONDARY, TEXT_MUTED, BORDER_FAINT, BG_SUBTLE, DANGER } from '../../styles/colors'

/**
 * Key/value editor for a product's `params` JSON, driven by PARAM_CATALOG.
 * Only catalog keys (scoped to `productType`) can be added — via the empty
 * bottom row's dropdown. Values are type-coerced (numbers stored as numbers,
 * `select` keys as dropdowns). Legacy/unknown keys already present stay shown
 * and removable. Emits the full params object on every change.
 */
export default function ParamsTable({ value, onChange, productType }: {
  value: Record<string, any> | null
  onChange: (next: Record<string, any>) => void
  productType: string
}) {
  const obj = value || {}
  const present = new Set(Object.keys(obj))
  const addable = catalogFor(productType).filter(d => !d.dedicated && !present.has(d.key))

  const setVal = (k: string, v: any) => onChange({ ...obj, [k]: v })
  const remove = (k: string) => { const n = { ...obj }; delete n[k]; onChange(n) }
  const add = (k: string) => {
    if (!k) return
    const e = catalogEntry(k)
    onChange({ ...obj, [k]: e?.default ?? '' })
  }

  const cellLabel: React.CSSProperties = { fontSize: '0.8rem', color: TEXT, display: 'flex', gap: 4, alignItems: 'baseline' }
  const input: React.CSSProperties = { width: '100%', padding: '0.3rem 0.4rem', fontSize: '0.82rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 4 }
  const rmBtn: React.CSSProperties = { background: 'none', border: 'none', color: DANGER, cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.3rem' }

  const renderValue = (k: string, v: any) => {
    const e = catalogEntry(k)
    if (e?.type === 'select') {
      return (
        <select value={v ?? ''} onChange={ev => setVal(k, ev.target.value)} style={input}>
          <option value="" disabled>—</option>
          {e.options!.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (!e || e.type === 'number') {
      return (
        <input type="number" value={v ?? ''} step="any"
          onChange={ev => setVal(k, ev.target.value === '' ? '' : Number(ev.target.value))} style={input} />
      )
    }
    return <input value={v ?? ''} onChange={ev => setVal(k, ev.target.value)} style={input} />
  }

  return (
    <div style={{ border: `1px solid ${BORDER_FAINT}`, borderRadius: 6, overflow: 'hidden' }}>
      {Object.entries(obj).map(([k, v]) => {
        const e = catalogEntry(k)
        return (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 28px', gap: 8, alignItems: 'center', padding: '0.35rem 0.5rem', borderBottom: `1px solid ${BORDER_FAINT}` }}>
            <span style={cellLabel} title={e?.help || k}>
              {e?.label || k}
              {e?.unit ? <span style={{ color: TEXT_MUTED, fontSize: '0.72rem' }}>{e.unit}</span> : null}
              {!e ? <span style={{ color: TEXT_MUTED, fontSize: '0.68rem' }}>(legacy)</span> : null}
            </span>
            {renderValue(k, v)}
            <button type="button" onClick={() => remove(k)} title="Remove" style={rmBtn}>×</button>
          </div>
        )
      })}

      {/* empty add row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr 28px', gap: 8, alignItems: 'center', padding: '0.35rem 0.5rem', background: BG_SUBTLE }}>
        <select value="" onChange={ev => add(ev.target.value)} disabled={addable.length === 0}
          style={{ ...input, color: TEXT_SECONDARY }}>
          <option value="">{addable.length ? '+ add parameter…' : 'all parameters added'}</option>
          {addable.map(d => <option key={d.key} value={d.key}>{d.label}{d.unit ? ` (${d.unit})` : ''}</option>)}
        </select>
        <span style={{ color: TEXT_MUTED, fontSize: '0.72rem' }} />
        <span />
      </div>
    </div>
  )
}
