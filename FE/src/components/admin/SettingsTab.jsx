import { useState, useEffect } from 'react'
import { getSettings, updateSetting } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
} from '../../styles/colors'

const SECTION_LABELS = { rails: 'Rails', bases: 'Bases', detail: 'Block & Detail' }

export default function SettingsTab() {
  const [settings, setSettings] = useState([])
  const [edits, setEdits] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSettings()
      .then(data => { setSettings(data); setLoading(false) })
      .catch(() => { setError('Failed to load settings'); setLoading(false) })
  }, [])

  const getValue = (s) => edits[s.key] !== undefined ? edits[s.key] : s.value_json

  const handleChange = (key, val) => setEdits(prev => ({ ...prev, [key]: val }))

  const handleSave = async (s) => {
    setSaving(prev => ({ ...prev, [s.key]: true }))
    try {
      let val = edits[s.key] !== undefined ? edits[s.key] : s.value_json
      if (s.param_type === 'number') val = Number(val)
      if (s.param_type === 'array') {
        val = String(val).split(',').map(v => Number(v.trim())).filter(v => !isNaN(v))
      }
      const updated = await updateSetting(s.key, val)
      setSettings(prev => prev.map(x => x.key === s.key ? updated : x))
      setEdits(prev => { const n = { ...prev }; delete n[s.key]; return n })
      setSaved(prev => ({ ...prev, [s.key]: true }))
      setTimeout(() => setSaved(prev => { const n = { ...prev }; delete n[s.key]; return n }), 2000)
    } catch {
      setError('Save failed')
    } finally {
      setSaving(prev => ({ ...prev, [s.key]: false }))
    }
  }

  const grouped = settings.reduce((acc, s) => {
    acc[s.section] = acc[s.section] || []
    acc[s.section].push(s)
    return acc
  }, {})

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT }}>Loading…</div>

  return (
    <div style={{ padding: '1rem 0' }}>
      {error && <div style={{ padding: '0.6rem 0.8rem', background: ERROR_BG, color: ERROR, borderRadius: '8px', marginBottom: '1rem', fontSize: '0.83rem' }}>{error}</div>}
      {Object.entries(grouped).map(([section, items]) => (
        <div key={section} style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
            {SECTION_LABELS[section] ?? section}
          </div>
          <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: '10px', overflow: 'hidden' }}>
            {items.map((s, i) => {
              const val = getValue(s)
              const isDirty = edits[s.key] !== undefined
              const displayVal = s.param_type === 'array' ? (Array.isArray(val) ? val.join(', ') : String(val)) : String(val)
              return (
                <div key={s.key} style={{
                  display: 'grid', gridTemplateColumns: '1fr 160px 80px 80px auto',
                  alignItems: 'center', gap: '0.5rem',
                  padding: '0.6rem 0.85rem',
                  background: i % 2 === 0 ? 'white' : BG_SUBTLE,
                  borderTop: i > 0 ? `1px solid ${BORDER_FAINT}` : 'none',
                }}>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: '600', color: TEXT_DARKEST }}>{s.label}</div>
                    <div style={{ fontSize: '0.68rem', color: TEXT_VERY_LIGHT }}>{s.scope} · {s.param_type}</div>
                  </div>
                  <input
                    value={displayVal}
                    onChange={e => handleChange(s.key, s.param_type === 'boolean' ? e.target.value === 'true' : e.target.value)}
                    style={{
                      padding: '0.35rem 0.5rem', borderRadius: '6px', fontSize: '0.85rem',
                      border: `1.5px solid ${isDirty ? TEXT_DARKEST : BORDER_LIGHT}`, outline: 'none',
                    }}
                  />
                  <div style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, textAlign: 'center' }}>
                    {s.min_val != null ? `min ${s.min_val}` : '—'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, textAlign: 'center' }}>
                    {s.max_val != null ? `max ${s.max_val}` : '—'}
                  </div>
                  <button
                    onClick={() => handleSave(s)}
                    disabled={!isDirty || saving[s.key]}
                    style={{
                      padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '700',
                      border: 'none', cursor: isDirty && !saving[s.key] ? 'pointer' : 'default',
                      background: saved[s.key] ? SUCCESS_BG : isDirty ? PRIMARY : BORDER_FAINT,
                      color: saved[s.key] ? SUCCESS : isDirty ? TEXT : TEXT_VERY_LIGHT,
                      minWidth: '52px',
                    }}
                  >
                    {saved[s.key] ? 'Saved' : saving[s.key] ? '…' : 'Save'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
