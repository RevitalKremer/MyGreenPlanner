import { useState, useEffect } from 'react'
import { useLang } from '../../i18n/LangContext'
import { fetchSadotEquipment } from '../../services/projectsApi'
import {
  PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT, BG_FAINT,
  SUCCESS_DARK,
} from '../../styles/colors'

// Closing "Final" summary. Renders construction always; electrical reflects
// whatever partial/full data exists (Path A/B/C).
export default function FinalSummary({ inverters, stringsCount, electricalApproval, onFinish }) {
  const { t } = useLang()
  const [byKey, setByKey] = useState<Record<string, any>>({})

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

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: BG_FAINT, padding: '2rem' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 700, color: TEXT, marginBottom: '1.5rem' }}>{t('final.title')}</div>

        {/* Construction (always present) */}
        <div style={card}>
          <div style={head}>{t('final.construction')}</div>
          <div style={{ ...row, borderBottom: 'none', color: SUCCESS_DARK }}>✓ {t('step.3.name')}</div>
        </div>

        {/* Electrical */}
        <div style={card}>
          <div style={head}>{t('final.electrical')}</div>
          {!hasElectrical ? (
            <div style={{ padding: '0.9rem 1.25rem', fontSize: '0.88rem', color: TEXT_MUTED, fontStyle: 'italic' }}>{t('final.notIncluded')}</div>
          ) : (
            <>
              <div style={row}>
                <span style={{ color: TEXT_MUTED }}>{t('final.inverters')}</span>
                <span>{picks.map(p => `${p.qty}× ${byKey[p.typeKey]?.name ?? p.typeKey}`).join(', ') || '—'}</span>
              </div>
              <div style={row}>
                <span style={{ color: TEXT_MUTED }}>{t('final.strings')}</span>
                <span>{stringsCount || 0}</span>
              </div>
              <div style={{ ...row, borderBottom: 'none' }}>
                <span style={{ color: TEXT_MUTED }}>{t('final.electricalApproval')}</span>
                <span style={{ color: electricalApproval?.strictConsent ? SUCCESS_DARK : TEXT_MUTED }}>
                  {electricalApproval?.strictConsent ? '✓' : '—'}
                </span>
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
