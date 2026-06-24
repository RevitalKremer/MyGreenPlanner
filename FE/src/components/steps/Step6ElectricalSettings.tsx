import { useState, useEffect } from 'react'
import { useLang } from '../../i18n/LangContext'
import { fetchSadotEquipment, getInverterSuggestions, fetchElectricalRegulations } from '../../services/projectsApi'
import IframeModal from '../shared/IframeModal'
import {
  PRIMARY, PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT,
  BG_LIGHT, BG_FAINT,
  SUCCESS_BG, SUCCESS_DARK,
  WARNING_DARK, WARNING_BG,
  BLUE,
} from '../../styles/colors'

// Standard Israeli grid connections (phases × amperage A). Min requirement 3×25.
const STD_CONNECTIONS = [
  { phases: 1, amperageA: 25 }, { phases: 1, amperageA: 40 },
  { phases: 3, amperageA: 25 }, { phases: 3, amperageA: 40 },
  { phases: 3, amperageA: 63 }, { phases: 3, amperageA: 80 },
  { phases: 3, amperageA: 100 }, { phases: 3, amperageA: 125 },
  { phases: 3, amperageA: 160 }, { phases: 3, amperageA: 200 },
  { phases: 3, amperageA: 250 }, { phases: 3, amperageA: 315 },
  { phases: 3, amperageA: 400 },
]
const connKey = (c: { phases: number; amperageA: number }) => `${c.phases}x${c.amperageA}`

// Step 6 — electrical design params + Sadot inverter selection. Settings drive
// the Step-7 string auto-generation; inverter picks drive sizing + the BOM.
export default function Step6ElectricalSettings({ projectId, settings, onSettingsChange, inverters, onInvertersChange, batteries, onBatteriesChange, onSave, panelCount, totalKw, areaCount, roofType, panelTypeName, panelSadotUrl }) {
  const { t, lang } = useLang()
  const [equipment, setEquipment] = useState<any[]>([])
  const [suggest, setSuggest] = useState<any>(null)
  const [pick, setPick] = useState('')
  const [batPick, setBatPick] = useState('')
  const [sadotModal, setSadotModal] = useState<{ url: string; title: string } | null>(null)
  const [regulations, setRegulations] = useState<any[]>([])
  const [suggesting, setSuggesting] = useState(false)

  const s = settings || {}
  const connSel = s.connection ? connKey(s.connection) : ''
  const regSel = s.regulationKey ?? ''
  const productCategory = s.productCategory ?? ''
  const plantType = s.plantType ?? ''

  useEffect(() => {
    fetchSadotEquipment().then(setEquipment).catch(() => setEquipment([]))
    fetchElectricalRegulations().then(setRegulations).catch(() => setRegulations([]))
  }, [])

  // The recommended capacity is computed server-side. Fetched on load and on
  // the explicit "Get recommendation" press (which also saves the params) —
  // so the materials area reflects a deliberate commit of Area 1, not every
  // half-typed change.
  const loadSuggestions = async () => {
    if (!projectId) return
    setSuggesting(true)
    try {
      const res = await getInverterSuggestions(projectId, {
        regulationKey: s.regulationKey ?? null,
        amperageA: s.connection?.amperageA ?? null,
        productCategory: s.productCategory ?? null,
      })
      setSuggest(res)
    } catch { setSuggest(null) } finally { setSuggesting(false) }
  }

  // "Get recommendation": persist the design parameters, then refresh.
  const handleGetRecommendation = async () => {
    try { await onSave?.() } catch (e) { console.error(e) }
    await loadSuggestions()
  }

  useEffect(() => {
    if (projectId) loadSuggestions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const byKey = Object.fromEntries(equipment.map(e => [e.type_key, e]))
  const picks = inverters || []
  // Sum of selected inverter AC capacity (kW) — shown against the recommended total.
  const selectedKw = picks.reduce((sum, p) => sum + (byKey[p.typeKey]?.params?.acPowerKw || 0) * (p.qty || 1), 0)

  // Active inverters (endpoint returns active-only), filtered to the selected
  // product category (on-grid / hybrid / off-grid) when one is chosen.
  const invOptions = equipment.filter(e =>
    e.product_type === 'inverter' &&
    (!productCategory || e.params?.productCategory === productCategory)
  )

  // Category options are built from the categories actually present among the
  // active inverters — e.g. if there's no active off-grid inverter, off-grid
  // isn't offered.
  const KNOWN_CATEGORIES = ['ongrid', 'hybrid', 'offgrid']
  const availableCategories = Array.from(new Set(
    equipment
      .filter(e => e.product_type === 'inverter' && e.params?.productCategory)
      .map(e => e.params.productCategory as string)
  )).sort((a, b) => KNOWN_CATEGORIES.indexOf(a) - KNOWN_CATEGORIES.indexOf(b))
  const categoryLabel = (c: string) =>
    KNOWN_CATEGORIES.includes(c) ? t(`step6.productCategory.${c}`) : c

  const setProductCategory = (v: string) =>
    onSettingsChange({ ...s, productCategory: v || null })

  const setConnection = (key: string) => {
    const c = STD_CONNECTIONS.find(x => connKey(x) === key)
    onSettingsChange({ ...s, connection: c ? { phases: c.phases, amperageA: c.amperageA } : null })
  }
  const setRegulation = (key: string) =>
    onSettingsChange({ ...s, regulationKey: key || null })
  const setPlantType = (v: string) =>
    onSettingsChange({ ...s, plantType: v || null })
  const regName = (r: any) => (lang === 'he' ? r.name_he : r.name_en)
  const selectedReg = regulations.find(r => r.key === regSel)

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

  // ── Batteries — user picks type + amount; filtered to the same product
  //    category (on-grid / off-grid / hybrid) as the inverters. ──
  const batOptions = equipment.filter(e =>
    e.product_type === 'battery' &&
    (!productCategory || e.params?.productCategory === productCategory)
  )
  const batPicks = batteries || []
  const addBattery = (typeKey: string) => {
    if (!typeKey || batPicks.some(p => p.typeKey === typeKey)) return
    onBatteriesChange([...batPicks, { typeKey, qty: 1 }])
    setBatPick('')
  }
  const setBatQty = (typeKey: string, qty: number) =>
    onBatteriesChange(batPicks.map(p => p.typeKey === typeKey ? { ...p, qty: Math.max(1, qty) } : p))
  const removeBattery = (typeKey: string) =>
    onBatteriesChange(batPicks.filter(p => p.typeKey !== typeKey))

  const batteryUnits = batPicks.reduce((n, p) => n + (p.qty || 1), 0)

  const card: React.CSSProperties = { background: 'white', borderRadius: 10, border: `1px solid ${BORDER}`, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', overflow: 'hidden' }
  const head: React.CSSProperties = { background: PRIMARY_BG, borderBottom: `1px solid ${BORDER_FAINT}`, padding: '0.9rem 1.25rem', fontWeight: 700, color: PRIMARY_DARK, fontSize: '1rem' }
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: '0.8rem', fontWeight: 600, color: TEXT_MUTED, marginBottom: '0.3rem' }
  const inputStyle: React.CSSProperties = { width: 110, padding: '0.45rem 0.6rem', fontSize: '0.9rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 6, textAlign: 'right' }
  const sectionLabel: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: TEXT_MUTED, margin: '0 0 0.6rem' }

  // One materials block: each group is a row split into a left caption column
  // and a right data column.
  const materialRow = (caption: string, content: React.ReactNode, last = false) => (
    <div style={{ display: 'flex', alignItems: 'stretch', borderBottom: last ? undefined : `1px solid ${BORDER}` }}>
      <div style={{ width: 150, flexShrink: 0, padding: '1.1rem 1.25rem', borderInlineEnd: `1px solid ${BORDER}`, background: PRIMARY_BG, fontWeight: 700, color: PRIMARY_DARK, fontSize: '0.95rem' }}>{caption}</div>
      <div style={{ flex: 1, minWidth: 0, padding: '1.1rem 1.25rem' }}>{content}</div>
    </div>
  )

  // A selected product is a mismatch when its category differs from the chosen
  // design-parameter category (e.g. user changed the category after adding it).
  const isMismatch = (typeKey: string) => {
    const cat = byKey[typeKey]?.params?.productCategory
    return !!(productCategory && cat && cat !== productCategory)
  }

  // Shared picker (select + add) for inverters / batteries.
  const Picker = (options: any[], value: string, setVal: (v: string) => void, onAdd: (v: string) => void, placeholder: string) => (
    <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
      <select value={value} onChange={e => setVal(e.target.value)}
        style={{ flex: 1, padding: '0.45rem 0.6rem', fontSize: '0.9rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 6 }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.type_key} value={o.type_key}>{o.name}</option>)}
      </select>
      <button onClick={() => onAdd(value)} disabled={!value}
        style={{ padding: '0.45rem 1rem', background: value ? PRIMARY_DARK : BG_LIGHT, color: value ? 'white' : TEXT_MUTED, border: 'none', borderRadius: 6, fontWeight: 600, cursor: value ? 'pointer' : 'not-allowed' }}>
        {t('step6.inverters.add')}
      </button>
    </div>
  )

  // Shared selected-row (name + Sadot link + mismatch flag + qty + remove).
  // Resolve a product's Sadot link for the current UI language.
  const sadotUrlFor = (u: any): string | null =>
    u ? (u[lang] || u.en || u.he || null) : null

  const EquipmentRow = (p: any, onQty: (k: string, q: number) => void, onRemove: (k: string) => void) => {
    const prod = byKey[p.typeKey]
    const mismatch = isMismatch(p.typeKey)
    const sUrl = sadotUrlFor(prod?.sadot_url)
    return (
      <div key={p.typeKey} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.55rem 0.7rem', borderRadius: 6, border: `1px solid ${mismatch ? WARNING_DARK : BORDER_FAINT}`, background: mismatch ? WARNING_BG : 'white' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: TEXT, display: 'flex', alignItems: 'center', gap: 6 }}>
            {prod?.name ?? p.typeKey}
            {mismatch && <span title={t('step6.mismatch')} style={{ color: WARNING_DARK }}>⚠</span>}
          </div>
          {sUrl && (
            <button onClick={() => setSadotModal({ url: sUrl, title: prod.name ?? p.typeKey })}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: '0.76rem', color: BLUE, cursor: 'pointer', textAlign: 'start' }}>
              {t('step6.inverters.viewSadot')}
            </button>
          )}
        </div>
        <label style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>{t('step6.inverters.qty')}</label>
        <input type="number" min={1} value={p.qty} onChange={e => onQty(p.typeKey, Number(e.target.value))}
          style={{ width: 56, padding: '0.35rem', fontSize: '0.88rem', border: `1px solid ${BORDER_FAINT}`, borderRadius: 6, textAlign: 'center' }} />
        <button onClick={() => onRemove(p.typeKey)} title={t('step6.inverters.remove')}
          style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: BG_FAINT, padding: '2rem' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: TEXT }}>{t('step6.title')}</div>
          <div style={{ fontSize: '0.88rem', color: TEXT_SECONDARY, marginTop: '0.3rem' }}>{t('step6.subtitle')}</div>
        </div>

        {/* ══ Area 1 — Design parameters ══ */}
        <div style={{ ...card, marginBottom: '1.75rem' }}>
          <div style={head}>{t('step6.settings.heading')}</div>
          <div style={{ padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>{t('step6.settings.connection')}</label>
              <select value={connSel} onChange={e => setConnection(e.target.value)}
                style={{ ...inputStyle, width: '100%', textAlign: 'start' }}>
                <option value="">{t('step6.settings.connectionPick')}</option>
                {STD_CONNECTIONS.map(c => (
                  <option key={connKey(c)} value={connKey(c)}>{c.phases} × {c.amperageA}A</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('step6.settings.regulation')}</label>
              <select value={regSel} onChange={e => setRegulation(e.target.value)}
                style={{ ...inputStyle, width: '100%', textAlign: 'start' }}>
                <option value="">{t('step6.settings.regulationPick')}</option>
                {regulations.map(r => (
                  <option key={r.key} value={r.key}>{regName(r)}</option>
                ))}
              </select>
              {selectedReg && (selectedReg.description_he || selectedReg.description_en) && (
                <div style={{ fontSize: '0.76rem', color: TEXT_MUTED, marginTop: '0.35rem', lineHeight: 1.45 }}>
                  {lang === 'he' ? selectedReg.description_he : selectedReg.description_en}
                  {(selectedReg.min_kw_ac != null || selectedReg.max_kw_ac != null) && (
                    <span> {`(${selectedReg.min_kw_ac ?? 0}–${selectedReg.max_kw_ac ?? '∞'} kW AC)`}</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <label style={labelStyle}>{t('step6.productCategory')}</label>
              <select value={productCategory} onChange={e => setProductCategory(e.target.value)}
                style={{ ...inputStyle, width: '100%', textAlign: 'start' }}>
                <option value="">{t('step6.productCategory.pick')}</option>
                {availableCategories.map(c => (
                  <option key={c} value={c}>{categoryLabel(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('step6.settings.plantType')}</label>
              <select value={plantType} onChange={e => setPlantType(e.target.value)}
                style={{ ...inputStyle, width: '100%', textAlign: 'start' }}>
                <option value="">{t('step6.settings.plantTypePick')}</option>
                <option value="residential">{t('step6.plantType.residential')}</option>
                <option value="commercial">{t('step6.plantType.commercial')}</option>
                <option value="commercial_agro">{t('step6.plantType.commercialAgro')}</option>
              </select>
            </div>
            {/* Completes Area 1 and leads into the materials area (conceptual —
                the user can return and change parameters anytime). */}
            <button onClick={handleGetRecommendation} disabled={suggesting || !projectId}
              style={{ marginTop: '0.3rem', padding: '0.65rem', background: suggesting ? BG_LIGHT : PRIMARY_DARK, color: suggesting ? TEXT_MUTED : 'white', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.92rem', cursor: suggesting ? 'wait' : 'pointer' }}>
              {suggesting ? '…' : t('step6.getRecommendation')}
            </button>
          </div>
        </div>

        {/* ══ Area 2 — Materials (one block: caption | data, per row) ══ */}
        <div style={sectionLabel}>{t('step6.materials')}</div>
        <div style={card}>
          {/* Inverters */}
          {materialRow(t('step6.inverters.heading'), (
            <>
              {(suggesting || suggest?.recommendedKw != null) && (() => {
                const rec = suggest?.recommendedKw ?? 0
                const over = rec > 0 && selectedKw > rec
                const pct = rec > 0 ? Math.min(100, (selectedKw / rec) * 100) : 0
                const fmt = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10)
                return (
                  <div style={{ background: SUCCESS_BG, borderRadius: 6, padding: '0.7rem 0.85rem', marginBottom: '1rem', color: SUCCESS_DARK }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{t('step6.inverters.suggested')}</span>
                      {!suggesting && rec > 0 && (
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: over ? WARNING_DARK : SUCCESS_DARK }}>
                          {fmt(selectedKw)} / {fmt(rec)} kW
                        </span>
                      )}
                    </div>
                    {suggesting ? (
                      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>…</div>
                    ) : rec > 0 && (
                      <div style={{ marginTop: 7, height: 8, borderRadius: 5, background: 'white', border: `1px solid ${BORDER_FAINT}`, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: over ? WARNING_DARK : PRIMARY, transition: 'width 0.3s ease' }} />
                      </div>
                    )}
                  </div>
                )
              })()}
              {Picker(invOptions, pick, setPick, addInverter, t('step6.inverters.pick'))}
              {picks.length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: TEXT_MUTED, fontStyle: 'italic' }}>{t('step6.inverters.none')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {picks.map(p => EquipmentRow(p, setQty, removeInverter))}
                </div>
              )}
            </>
          ))}

          {/* Batteries — hidden entirely when there are none to add (and none picked) */}
          {(batOptions.length > 0 || batPicks.length > 0) && materialRow(t('step6.batteries.heading'), (
            <>
              {batPicks.length > 0 && (
                <div style={{ background: SUCCESS_BG, borderRadius: 6, padding: '0.6rem 0.85rem', marginBottom: '1rem', fontWeight: 700, fontSize: '0.85rem', color: SUCCESS_DARK }}>
                  {t('step6.batteries.metric', { units: batteryUnits })}
                </div>
              )}
              {Picker(batOptions, batPick, setBatPick, addBattery, t('step6.batteries.pick'))}
              {batPicks.length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: TEXT_MUTED, fontStyle: 'italic' }}>{t('step6.batteries.none')}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {batPicks.map(p => EquipmentRow(p, setBatQty, removeBattery))}
                </div>
              )}
            </>
          ))}

          {/* Panels (read-only) — at the bottom */}
          {materialRow(t('step6.panels.heading'), (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.5rem 1rem', fontSize: '1rem', color: TEXT }}>
              <span style={{ fontWeight: 700 }}>{(totalKw ?? 0).toFixed(2)} kWp</span>
              <span style={{ color: TEXT_MUTED }}>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {panelCount ?? 0} × {panelTypeName || '—'}
                {sadotUrlFor(panelSadotUrl) && (
                  <button onClick={() => setSadotModal({ url: sadotUrlFor(panelSadotUrl)!, title: panelTypeName || 'Panel' })}
                    title={t('step6.inverters.viewSadot')}
                    style={{ background: 'none', border: 'none', padding: 0, color: BLUE, cursor: 'pointer', fontSize: '0.9rem' }}>↗</button>
                )}
              </span>
            </div>
          ), true)}
        </div>
      </div>

      {sadotModal && (
        <IframeModal url={sadotModal.url} title={sadotModal.title} onClose={() => setSadotModal(null)} />
      )}
    </div>
  )
}
