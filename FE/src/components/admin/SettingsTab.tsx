import { useState, useEffect } from 'react'
import { getSettings, updateSetting } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
} from '../../styles/colors'

const SECTION_LABELS = { global: 'Global', rails: 'Rails', bases: 'Bases', detail: 'Block & Detail' }
const ROOF_TYPES = ['concrete', 'iskurit', 'insulated_panel', 'tiles']
const ROOF_TYPE_SHORT = { concrete: 'C', iskurit: 'I', insulated_panel: 'IP', tiles: 'T' }

export default function SettingsTab() {
  const [settings, setSettings] = useState([])
  const [edits, setEdits] = useState({})       // key → new value_json string
  const [minEdits, setMinEdits] = useState({})  // key → new min_val string
  const [maxEdits, setMaxEdits] = useState({})  // key → new max_val string
  const [stepEdits, setStepEdits] = useState({}) // key → new step_val string
  const [visibleEdits, setVisibleEdits] = useState({}) // key → new visible boolean
  const [roofTypesEdits, setRoofTypesEdits] = useState({}) // key → new roof_types array or null
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
  const isDirty = (s) => edits[s.key] !== undefined || minEdits[s.key] !== undefined || maxEdits[s.key] !== undefined || stepEdits[s.key] !== undefined || visibleEdits[s.key] !== undefined || roofTypesEdits[s.key] !== undefined

  const handleSave = async (s) => {
    setSaving(prev => ({ ...prev, [s.key]: true }))
    try {
      let val = edits[s.key] !== undefined ? edits[s.key] : s.value_json
      if (s.param_type === 'number') val = Number(val)
      if (s.param_type === 'array') {
        val = String(val).split(',').map(v => Number(v.trim())).filter(v => !isNaN(v))
      }

      const payload = { value_json: val }
      if (minEdits[s.key] !== undefined) payload.min_val = minEdits[s.key] === '' ? null : Number(minEdits[s.key])
      if (maxEdits[s.key] !== undefined) payload.max_val = maxEdits[s.key] === '' ? null : Number(maxEdits[s.key])
      if (stepEdits[s.key] !== undefined) payload.step_val = stepEdits[s.key] === '' ? null : Number(stepEdits[s.key])
      if (visibleEdits[s.key] !== undefined) payload.visible = visibleEdits[s.key]
      if (roofTypesEdits[s.key] !== undefined) payload.roof_types = roofTypesEdits[s.key]

      const updated = await updateSetting(s.key, payload)
      setSettings(prev => prev.map(x => x.key === s.key ? updated : x))
      setEdits(prev => { const n = { ...prev }; delete n[s.key]; return n })
      setMinEdits(prev => { const n = { ...prev }; delete n[s.key]; return n })
      setMaxEdits(prev => { const n = { ...prev }; delete n[s.key]; return n })
      setStepEdits(prev => { const n = { ...prev }; delete n[s.key]; return n })
      setVisibleEdits(prev => { const n = { ...prev }; delete n[s.key]; return n })
      setRoofTypesEdits(prev => { const n = { ...prev }; delete n[s.key]; return n })
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
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 160px 100px 100px 80px 80px 140px auto',
            alignItems: 'center', gap: '0.5rem',
            padding: '0.3rem 0.85rem',
            borderRadius: '8px 8px 0 0',
          }}>
            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Parameter</div>
            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Default</div>
            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Min</div>
            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Max</div>
            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Step</div>
            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Visible</div>
            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Roof Types</div>
            <div />
          </div>
          <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: '10px', overflow: 'hidden' }}>
            {items.map((s, i) => {
              const val = getValue(s)
              const dirty = isDirty(s)
              const displayVal = s.param_type === 'array' ? (Array.isArray(val) ? val.join(', ') : String(val)) : String(val)
              const displayMin  = minEdits[s.key]  !== undefined ? minEdits[s.key]  : (s.min_val  != null ? String(s.min_val)  : '')
              const displayMax  = maxEdits[s.key]  !== undefined ? maxEdits[s.key]  : (s.max_val  != null ? String(s.max_val)  : '')
              const displayStep = stepEdits[s.key] !== undefined ? stepEdits[s.key] : (s.step_val != null ? String(s.step_val) : '')
              const currentVisible = visibleEdits[s.key] !== undefined ? visibleEdits[s.key] : (s.visible ?? true)

              const inputStyle = (isDirtyField) => ({
                padding: '0.35rem 0.5rem', borderRadius: '6px', fontSize: '0.85rem',
                border: `1.5px solid ${isDirtyField ? TEXT_DARKEST : BORDER_LIGHT}`, outline: 'none',
                width: '100%', boxSizing: 'border-box',
              })

              return (
                <div key={s.key} style={{
                  display: 'grid', gridTemplateColumns: '1fr 160px 100px 100px 80px 80px 140px auto',
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
                    onChange={e => setEdits(prev => ({ ...prev, [s.key]: s.param_type === 'boolean' ? e.target.value === 'true' : e.target.value }))}
                    style={inputStyle(edits[s.key] !== undefined)}
                  />
                  <input
                    value={displayMin}
                    placeholder="—"
                    onChange={e => setMinEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                    style={inputStyle(minEdits[s.key] !== undefined)}
                    type="number"
                  />
                  <input
                    value={displayMax}
                    placeholder="—"
                    onChange={e => setMaxEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                    style={inputStyle(maxEdits[s.key] !== undefined)}
                    type="number"
                  />
                  <input
                    value={displayStep}
                    placeholder="—"
                    onChange={e => setStepEdits(prev => ({ ...prev, [s.key]: e.target.value }))}
                    style={inputStyle(stepEdits[s.key] !== undefined)}
                    type="number"
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="checkbox"
                      checked={currentVisible}
                      onChange={e => setVisibleEdits(prev => ({ ...prev, [s.key]: e.target.checked }))}
                      style={{ 
                        width: '18px', 
                        height: '18px', 
                        cursor: 'pointer',
                        accentColor: PRIMARY,
                      }}
                      title={currentVisible ? 'Visible in Step3 Sidebar' : 'Hidden (admin only)'}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                    {ROOF_TYPES.map(rt => {
                      const current = roofTypesEdits[s.key] !== undefined ? roofTypesEdits[s.key] : s.roof_types
                      const isAll = current === null || current === undefined
                      const isActive = isAll || (Array.isArray(current) && current.includes(rt))
                      return (
                        <button
                          key={rt}
                          onClick={() => {
                            const prev = roofTypesEdits[s.key] !== undefined ? roofTypesEdits[s.key] : s.roof_types
                            let arr = prev === null || prev === undefined ? [...ROOF_TYPES] : [...prev]
                            if (arr.includes(rt)) {
                              arr = arr.filter(x => x !== rt)
                            } else {
                              arr.push(rt)
                            }
                            const newVal = arr.length === ROOF_TYPES.length ? null : arr
                            setRoofTypesEdits(p => ({ ...p, [s.key]: newVal }))
                          }}
                          style={{
                            padding: '1px 5px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: '600',
                            border: `1px solid ${isActive ? PRIMARY : BORDER_LIGHT}`,
                            background: isActive ? PRIMARY : 'white',
                            color: isActive ? 'white' : TEXT_VERY_LIGHT,
                            cursor: 'pointer', lineHeight: '1.4',
                          }}
                          title={rt}
                        >
                          {ROOF_TYPE_SHORT[rt]}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => handleSave(s)}
                    disabled={!dirty || saving[s.key]}
                    style={{
                      padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '700',
                      border: 'none', cursor: dirty && !saving[s.key] ? 'pointer' : 'default',
                      background: saved[s.key] ? SUCCESS_BG : dirty ? PRIMARY : BORDER_FAINT,
                      color: saved[s.key] ? SUCCESS : dirty ? TEXT : TEXT_VERY_LIGHT,
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
