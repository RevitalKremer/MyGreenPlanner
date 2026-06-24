import { useState, useEffect, useMemo } from 'react'
import { useLang } from '../../i18n/LangContext'
import { fetchSadotEquipment } from '../../services/projectsApi'
import StringsPlanTab from './step7/StringsPlanTab'
import SummaryTab from './step7/SummaryTab'
import SldTab from './step7/SldTab'
import { TEXT, TEXT_PLACEHOLDER, BORDER_FAINT, BG_LIGHT, BG_FAINT, PRIMARY } from '../../styles/colors'

// Build the physical inverter units (expand by qty) and the flat list of MPPT
// inputs across the whole fleet. The BE assigns each string a flat `mpptIndex`
// into this same ordered port list, so a string → port lookup is index-based.
export function buildFleet(inverters: any[], byKey: Record<string, any>) {
  const units: { typeKey: string; name: string; kw: number | null; mpptCount: number; maxStringsPerMppt: number }[] = []
  ;(inverters || []).forEach((p: any) => {
    const prod = byKey[p.typeKey]
    const mpptCount = prod?.params?.mpptCount || 2
    const kw = prod?.params?.acPowerKw ?? null
    const maxStringsPerMppt = prod?.params?.maxStringsPerMppt || 1
    for (let q = 0; q < (p.qty || 1); q++) {
      units.push({ typeKey: p.typeKey, name: prod?.name || p.typeKey, kw, mpptCount, maxStringsPerMppt })
    }
  })
  const ports: { unitIdx: number; portIdx: number }[] = []
  units.forEach((u, ui) => { for (let m = 0; m < u.mpptCount; m++) ports.push({ unitIdx: ui, portIdx: m }) })
  return { units, ports }
}

// Step 7 host — tabs over the string plan (diagram) and the distribution
// summary. Both tabs stay mounted (visibility toggled) so their state is kept
// when switching. `units`/`ports` are derived once here and shared with both.
export default function Step7StringsPlan({ projectId, panels, inverters, areas, strings, onStringsChange, inverterLayout, onInverterLayoutChange, mode, onModeChange, panelWatt }: any) {
  const { t } = useLang()
  const [equipment, setEquipment] = useState<any[]>([])
  const [tab, setTab] = useState<'diagram' | 'sld' | 'distribution'>('diagram')

  useEffect(() => { fetchSadotEquipment().then(setEquipment).catch(() => setEquipment([])) }, [])

  const byKey = useMemo(() => Object.fromEntries(equipment.map(e => [e.type_key, e])), [equipment])
  const { units, ports } = useMemo(() => buildFleet(inverters, byKey), [inverters, byKey])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: `2px solid ${BORDER_FAINT}`, background: BG_LIGHT, padding: '0 1rem', gap: '0.25rem', flexShrink: 0 }}>
        {[['diagram', t('step7.tab.diagram')], ['sld', t('step7.tab.sld')], ['distribution', t('step7.tab.distribution')]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key as any)}
            style={{ padding: '0.55rem 1rem', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
              background: tab === key ? 'white' : 'transparent', color: tab === key ? TEXT : TEXT_PLACEHOLDER,
              borderBottom: tab === key ? `2px solid ${PRIMARY}` : '2px solid transparent', marginBottom: '-2px', transition: 'all 0.15s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Strings plan tab (kept mounted to preserve its state) */}
      <div style={{ flex: 1, minHeight: 0, display: tab === 'diagram' ? 'block' : 'none', background: BG_FAINT }}>
        <StringsPlanTab
          projectId={projectId} panels={panels} areas={areas} strings={strings} onStringsChange={onStringsChange}
          inverterLayout={inverterLayout} onInverterLayoutChange={onInverterLayoutChange}
          mode={mode} onModeChange={onModeChange}
          units={units} ports={ports} />
      </div>

      {/* Single-line wiring diagram tab */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: tab === 'sld' ? 'block' : 'none', background: 'white' }}>
        <SldTab units={units} strings={strings} panelWatt={panelWatt} />
      </div>

      {/* Summary tab */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: tab === 'distribution' ? 'block' : 'none', background: 'white' }}>
        <SummaryTab projectId={projectId} units={units} strings={strings} panelWatt={panelWatt} />
      </div>
    </div>
  )
}
