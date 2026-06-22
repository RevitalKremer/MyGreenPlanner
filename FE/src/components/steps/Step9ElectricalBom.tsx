import { useState, useEffect } from 'react'
import { useLang } from '../../i18n/LangContext'
import { getElectricalBomEffective, computeElectricalBOM, recalcElectricalBOM } from '../../services/projectsApi'
import {
  PRIMARY_DARK,
  TEXT, TEXT_SECONDARY, TEXT_MUTED,
  BORDER, BORDER_FAINT, BG_FAINT, PRIMARY_BG,
} from '../../styles/colors'

// Step 9 — electrical (Sadot goods) BOM table. Reads the separate
// project_electrical_bom stack via the /electrical-bom endpoints.
export default function Step9ElectricalBom({ projectId }) {
  const { t } = useLang()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!projectId) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await getElectricalBomEffective(projectId)
      setItems(res.items || [])
    } catch {
      // Not computed yet — compute then re-read.
      try {
        await computeElectricalBOM(projectId)
        const res = await getElectricalBomEffective(projectId)
        setItems(res.items || [])
      } catch { setItems([]) }
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecalc = async () => {
    if (!projectId) return
    setLoading(true)
    try { await recalcElectricalBOM(projectId) } catch { /* ignore */ }
    await load()
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.8rem', fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, borderBottom: `1px solid ${BORDER}` }
  const td: React.CSSProperties = { padding: '0.6rem 0.8rem', fontSize: '0.88rem', color: TEXT, borderBottom: `1px solid ${BORDER_FAINT}` }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: BG_FAINT, padding: '2rem' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: TEXT }}>{t('step9.title')}</div>
            <div style={{ fontSize: '0.88rem', color: TEXT_SECONDARY, marginTop: '0.3rem' }}>{t('step9.subtitle')}</div>
          </div>
          <button onClick={handleRecalc} disabled={loading}
            style={{ padding: '0.5rem 1rem', background: 'white', border: `1px solid ${BORDER}`, borderRadius: 6, color: PRIMARY_DARK, fontWeight: 600, fontSize: '0.85rem', cursor: loading ? 'wait' : 'pointer' }}>
            {t('step9.recalc')}
          </button>
        </div>

        <div style={{ background: 'white', border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: TEXT_MUTED }}>…</div>
          ) : items.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: TEXT_MUTED, fontSize: '0.9rem' }}>{t('step9.empty')}</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ background: PRIMARY_BG }}>
                <tr>
                  <th style={th}>{t('step9.col.item')}</th>
                  <th style={th}>{t('step9.col.section')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('step9.col.qty')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{t('step9.col.price')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={`${it.element}-${i}`}>
                    <td style={td}>
                      {it.name || it.element}
                      {it.sadotUrl && (
                        <a href={it.sadotUrl} target="_blank" rel="noreferrer" style={{ marginInlineStart: 8, fontSize: '0.75rem' }}>↗</a>
                      )}
                    </td>
                    <td style={{ ...td, color: TEXT_SECONDARY }}>{it.section || '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.qty}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{it.priceIls != null ? Number(it.priceIls).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
