import { useState, useEffect } from 'react'
import { useLang } from '../../i18n/LangContext'
import { fetchSadotEquipment, downloadProposal, downloadProduction } from '../../services/projectsApi'
import BasicInfoCard from '../shared/BasicInfoCard'
import {
  PRIMARY, PRIMARY_BG, PRIMARY_DARK, BLACK,
  TEXT, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT, BG_FAINT,
  SUCCESS_DARK,
} from '../../styles/colors'

// Closing "Final" summary — the project's deliverables HUB.
//   ① Basic     — system facts (panels, kW, areas…)
//   ② Construction — status + CTAs (Get Quotation, PDF, Excel/Production by role)
//   ③ Electricity  — status only (inverters / strings / approval), path-aware
export default function FinalSummary({
  projectId, projectName, isAdmin,
  panelCount, totalKw, areaCount, roofType, panelTypeName,
  hasRequestedQuotation, onGetQuotation, onDownloadPdf,
  onGetEquipmentQuotation, onDownloadElectricalPdf, onDownloadEquipmentXlsx,
  inverters, stringsCount, electricalApproval, onFinish,
}) {
  const { t } = useLang()
  const [byKey, setByKey] = useState<Record<string, any>>({})
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetchSadotEquipment()
      .then(list => setByKey(Object.fromEntries(list.map((e: any) => [e.type_key, e]))))
      .catch(() => {})
  }, [])

  const picks = inverters || []
  const hasElectrical = picks.length > 0 || (stringsCount || 0) > 0

  const card: React.CSSProperties = { background: 'white', borderRadius: 10, border: `1px solid ${BORDER}`, overflow: 'hidden', marginBottom: '1.25rem' }
  const head: React.CSSProperties = { background: PRIMARY_BG, borderBottom: `1px solid ${BORDER_FAINT}`, padding: '0.8rem 1.25rem', fontWeight: 700, color: PRIMARY_DARK }
  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '0.55rem 1.25rem', fontSize: '0.9rem', color: TEXT, borderBottom: `1px solid ${BORDER_FAINT}` }

  const factRow = (label: string, value: any) => (
    <div style={row}><span style={{ color: TEXT_MUTED }}>{label}</span><span style={{ fontWeight: 600 }}>{value}</span></div>
  )

  const ctaBtn = (label: string, onClick: () => void, primary = false, disabled = false) => (
    <button onClick={onClick} disabled={disabled}
      style={{
        padding: '0.55rem 1.1rem', borderRadius: 7, fontSize: '0.85rem', fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        background: primary ? PRIMARY : 'white', color: BLACK,
        border: `1.5px solid ${primary ? PRIMARY : BORDER}`,
      }}>
      {label}
    </button>
  )

  const runDownload = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (e) { console.error(e) } finally { setBusy(null) }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: BG_FAINT, padding: '2rem' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: TEXT, marginBottom: '1.5rem' }}>{t('final.title')}</div>

        {/* ① Basic */}
        <div style={{ marginBottom: '1.25rem' }}>
          <BasicInfoCard panelCount={panelCount} totalKw={totalKw} areaCount={areaCount} roofType={roofType} panelTypeName={panelTypeName} />
        </div>

        {/* ② Construction — status + deliverables CTAs */}
        <div style={card}>
          <div style={head}>{t('final.construction')}</div>
          <div style={{ ...row, color: SUCCESS_DARK }}>✓ {t('step.3.name')}</div>
          <div style={{ padding: '0.9rem 1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
            {ctaBtn(hasRequestedQuotation ? t('step5.quotation.requestAgain') : t('step5.quotation.getQuotation'), () => onGetQuotation?.(), true, !projectId)}
            {ctaBtn(t('step5.btn.generatePdf'), () => onDownloadPdf?.(), false, !projectId)}
            {isAdmin && ctaBtn(busy === 'excel' ? '…' : t('final.exportExcel'), () => runDownload('excel', () => downloadProposal(projectId, projectName)), false, !projectId || !!busy)}
            {isAdmin && ctaBtn(busy === 'prod' ? '…' : t('final.production'), () => runDownload('prod', () => downloadProduction(projectId, projectName)), false, !projectId || !!busy)}
          </div>
        </div>

        {/* ③ Electricity — status only */}
        <div style={card}>
          <div style={head}>{t('final.electrical')}</div>
          {!hasElectrical ? (
            <div style={{ padding: '0.9rem 1.25rem', fontSize: '0.88rem', color: TEXT_MUTED, fontStyle: 'italic' }}>{t('final.notIncluded')}</div>
          ) : (
            <>
              <div style={row}>
                <span style={{ color: TEXT_MUTED }}>{t('final.inverters')}</span>
                <span style={{ fontWeight: 600 }}>{picks.map(p => `${p.qty}× ${byKey[p.typeKey]?.name ?? p.typeKey}`).join(', ') || '—'}</span>
              </div>
              {factRow(t('final.strings'), stringsCount || 0)}
              <div style={row}>
                <span style={{ color: TEXT_MUTED }}>{t('final.electricalApproval')}</span>
                <span style={{ color: electricalApproval?.strictConsent ? SUCCESS_DARK : TEXT_MUTED, fontWeight: 600 }}>
                  {electricalApproval?.strictConsent ? '✓' : '—'}
                </span>
              </div>
              {/* Electrical deliverables — same actions as Step 9 */}
              <div style={{ padding: '0.9rem 1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                {ctaBtn(hasRequestedQuotation ? t('step5.quotation.requestAgain') : t('step9.getQuotation'), () => onGetEquipmentQuotation?.(), true, !projectId)}
                {ctaBtn(t('step9.menu.diagramsPdf'), () => onDownloadElectricalPdf?.(), false, !projectId)}
                {isAdmin && ctaBtn(t('step9.menu.equipmentXlsx'), () => onDownloadEquipmentXlsx?.(), false, !projectId)}
              </div>
            </>
          )}
        </div>

        <button onClick={onFinish}
          style={{ padding: '0.8rem 2rem', background: PRIMARY_DARK, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}>
          {t('final.finish')}
        </button>
      </div>
    </div>
  )
}
