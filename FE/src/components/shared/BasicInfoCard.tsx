import { useLang } from '../../i18n/LangContext'
import { PRIMARY_BG, PRIMARY_DARK, TEXT, TEXT_MUTED, BORDER, BORDER_FAINT } from '../../styles/colors'

// Shared "Basic" system-facts table — rendered at the top of Step 6 and in the
// Final summary so both show the same figures (panels, total DC power, …).
export default function BasicInfoCard({ panelCount, totalKw, areaCount, roofType, panelTypeName }) {
  const { t } = useLang()
  const card: React.CSSProperties = { background: 'white', borderRadius: 10, border: `1px solid ${BORDER}`, overflow: 'hidden' }
  const head: React.CSSProperties = { background: PRIMARY_BG, borderBottom: `1px solid ${BORDER_FAINT}`, padding: '0.8rem 1.25rem', fontWeight: 700, color: PRIMARY_DARK }
  const row = (last = false): React.CSSProperties => ({ display: 'flex', justifyContent: 'space-between', padding: '0.55rem 1.25rem', fontSize: '0.9rem', color: TEXT, borderBottom: last ? 'none' : `1px solid ${BORDER_FAINT}` })
  const fact = (label: string, value: any, last = false) => (
    <div style={row(last)}><span style={{ color: TEXT_MUTED }}>{label}</span><span style={{ fontWeight: 600 }}>{value}</span></div>
  )
  return (
    <div style={card}>
      <div style={head}>{t('phase.basic')}</div>
      {fact(t('final.basic.panels'), panelCount ?? 0)}
      {fact(t('final.basic.totalKw'), `${(totalKw ?? 0).toFixed(2)} kWp`)}
      {fact(t('final.basic.areas'), areaCount ?? 0)}
      {fact(t('final.basic.panelType'), panelTypeName || '—')}
      {fact(t('final.basic.roofType'), roofType || '—', true)}
    </div>
  )
}
