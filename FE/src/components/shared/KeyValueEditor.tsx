import { useState } from 'react'
import { BORDER_LIGHT, TEXT_SECONDARY, PRIMARY_DARK, BG_LIGHT, TEXT_MUTED, DANGER } from '../../styles/colors'

// Edit a flat string→string JSON object by selecting a key (from allowedKeys)
// and entering its value. Lists existing entries with a remove button.
export default function KeyValueEditor({ value, onChange, allowedKeys, placeholder }: {
  value: Record<string, string> | null | undefined
  onChange: (v: Record<string, string> | null) => void
  allowedKeys: { key: string; label: string }[]
  placeholder?: string
}) {
  const obj = value || {}
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const available = allowedKeys.filter(a => !(a.key in obj))
  const labelOf = (key: string) => allowedKeys.find(a => a.key === key)?.label ?? key

  const add = () => {
    if (!k || !v.trim()) return
    onChange({ ...obj, [k]: v.trim() })
    setK(''); setV('')
  }
  const remove = (key: string) => {
    const next = { ...obj }; delete next[key]
    onChange(Object.keys(next).length ? next : null)
  }

  return (
    <div>
      {Object.keys(obj).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
          {Object.entries(obj).map(([key, val]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 700, minWidth: 30 }}>{labelOf(key)}</span>
              <span style={{ flex: 1, color: TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
              <button onClick={() => remove(key)} style={{ background: 'none', border: 'none', color: DANGER, cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {available.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={k} onChange={e => setK(e.target.value)}
            style={{ padding: '0.3rem', borderRadius: 5, border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem' }}>
            <option value="">…</option>
            {available.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <input value={v} onChange={e => setV(e.target.value)} placeholder={placeholder}
            style={{ flex: 1, padding: '0.3rem 0.5rem', borderRadius: 5, border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem' }} />
          <button onClick={add} disabled={!k || !v.trim()}
            style={{ padding: '0.3rem 0.7rem', background: (k && v.trim()) ? PRIMARY_DARK : BG_LIGHT, color: (k && v.trim()) ? 'white' : TEXT_MUTED, border: 'none', borderRadius: 5, cursor: (k && v.trim()) ? 'pointer' : 'not-allowed', fontSize: '0.8rem', fontWeight: 700 }}>+</button>
        </div>
      )}
    </div>
  )
}
