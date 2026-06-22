import { useState, useEffect } from 'react'
import { useLang } from '../../i18n/LangContext'
import { fetchSadotEquipment, getInverterSuggestions } from '../../services/projectsApi'
import {
  PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT,
  BG_LIGHT, BG_FAINT,
  SUCCESS_BG, SUCCESS_DARK,
  BLUE,
} from '../../styles/colors'

const DEFAULT_TEMP_MIN = -5
const DEFAULT_TEMP_MAX_CELL = 70

// Step 6 — electrical design params + Sadot inverter selection. Settings drive
// the Step-7 string auto-generation; inverter picks drive sizing + the BOM.
export default function Step6ElectricalSettings({ projectId, settings, onSettingsChange, inverters, onInvertersChange }) {
  const { t } = useLang()
  const [equipment, setEquipment] = useState<any[]>([])
  const [suggest, setSuggest] = useState<any>(null)
  const [pick, setPick] = useState('')

  const s = settings || {}
  const tempMin = s.designTempMinC ?? DEFAULT_TEMP_MIN
  const tempMax = s.designTempMaxCellC ?? DEFAULT_TEMP_MAX_CELL

  useEffect(() => {
    fetchSadotEquipment().then(setEquipment).catch(() => setEquipment([]))
  }, [])

  useEffect(() => {
    if (projectId) getInverterSuggestions(projectId).then(setSuggest).catch(() => setSuggest(null))
  }, [projectId])

  const invOptions = equipment.filter(e => e.product_type === 'inverter')
  const byKey = Object.fromEntries(equipment.map(e => [e.type_key, e]))
  const picks = inverters || []

  const setSetting = (key: string, val: number) =>
    onSettingsChange({ ...s, [key]: val })

  const addInverter = (typeKey: string) => {
    if (!typeKey) return
    if (picks.some(p => p.typeKey === typeKey)) return
    onInvertersChange([...picks, { typeKey, qty: 1 }])
    setPick('')
  }
  const setQty = (typeKey: string, qty: number) =>
    onInvertersChange(picks.map(p => p.typeKey === typeKey ? { ...p, qty: Math.max(1, qty) } : p))
  const removeInverter = (typeKey: string) =>
    onInvertersChange(picks.filter(p => p.typeKey !== typeKey))

  const card: React.CSSProperties = { background: 'white', borderRadius: 10, border: `1px solid ${BORDER}`, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', overflow: 'hidden' }
  const head: React.CSSProperties = { background: PRIMARY_BG, borderBottom: `1px solid ${BORDER_FAINT}`, padding: '0.9rem 1.25rem', fontWeight: 700, color: PRIMARY_DARK, fontSize: '1rem' }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: TEXT_MUTED, marginBottom: '0.3rem' }
  const inputStyle: React.CSSProperties = { width: 110, padding: '0.45rem 0.6rem', fontSize: '0.9rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 6, textAlign: 'right' }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: BG_FAINT, padding: '2rem' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: TEXT }}>{t('step6.title')}</div>
          <div style={{ fontSize: '0.88rem', color: TEXT_SECONDARY, marginTop: '0.3rem' }}>{t('step6.subtitle')}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: '1.25rem', alignItems: 'start' }}>
          {/* ── Design parameters ── */}
          <div style={card}>
            <div style={head}>{t('step6.settings.heading')}</div>
            <div style={{ padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>{t('step6.settings.tempMin')}</label>
                <input type="number" value={tempMin} style={inputStyle}
                  onChange={e => setSetting('designTempMinC', Number(e.target.value))} />
              </div>
              <div>
                <label style={labelStyle}>{t('step6.settings.tempMax')}</label>
                <input type="number" value={tempMax} style={inputStyle}
                  onChange={e => setSetting('designTempMaxCellC', Number(e.target.value))} />
              </div>
              <div style={{ fontSize: '0.78rem', color: TEXT_MUTED, lineHeight: 1.5 }}>{t('step6.settings.tempHint')}</div>
            </div>
          </div>

          {/* ── Inverter selection ── */}
          <div style={card}>
            <div style={head}>{t('step6.inverters.heading')}</div>
            <div style={{ padding: '1.1rem 1.25rem' }}>
              {suggest && (
                <div style={{ background: SUCCESS_BG, borderRadius: 6, padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.82rem', color: SUCCESS_DARK }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{t('step6.inverters.suggested')}</div>
                  <div>{t('step6.inverters.totalDc', { kw: ((suggest.totalDcW || 0) / 1000).toFixed(1), panels: suggest.panelCount })}</div>
                  {(suggest.suggestions || []).slice(0, 3).map((sg: any) => (
                    <div key={sg.typeKey} style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>{sg.qty}× {sg.name} · {t('step6.inverters.dcAc', { ratio: sg.dcAcRatio })}</span>
                      <button onClick={() => addInverter(sg.typeKey)} style={{ background: 'none', border: 'none', color: BLUE, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}>
                        {t('step6.inverters.add')}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Picker */}
              <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
                <select value={pick} onChange={e => setPick(e.target.value)}
                  style={{ flex: 1, padding: '0.45rem 0.6rem', fontSize: '0.9rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 6 }}>
                  <option value="">{t('step6.inverters.pick')}</option>
                  {invOptions.map(inv => <option key={inv.type_key} value={inv.type_key}>{inv.name}</option>)}
                </select>
                <button onClick={() => addInverter(pick)} disabled={!pick}
                  style={{ padding: '0.45rem 1rem', background: pick ? PRIMARY_DARK : BG_LIGHT, color: pick ? 'white' : TEXT_MUTED, border: 'none', borderRadius: 6, fontWeight: 600, cursor: pick ? 'pointer' : 'not-allowed' }}>
                  {t('step6.inverters.add')}
                </button>
              </div>

              {/* Selected list */}
              {picks.length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: TEXT_MUTED, fontStyle: 'italic' }}>{t('step6.inverters.none')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {picks.map(p => {
                    const prod = byKey[p.typeKey]
                    return (
                      <div key={p.typeKey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.55rem 0.7rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 6 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: TEXT }}>{prod?.name ?? p.typeKey}</div>
                          {prod?.sadot_url && (
                            <a href={prod.sadot_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.76rem', color: BLUE, textDecoration: 'none' }}>
                              {t('step6.inverters.viewSadot')}
                            </a>
                          )}
                        </div>
                        <label style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>{t('step6.inverters.qty')}</label>
                        <input type="number" min={1} value={p.qty}
                          onChange={e => setQty(p.typeKey, Number(e.target.value))}
                          style={{ width: 56, padding: '0.35rem', fontSize: '0.88rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 6, textAlign: 'center' }} />
                        <button onClick={() => removeInverter(p.typeKey)} title={t('step6.inverters.remove')}
                          style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
