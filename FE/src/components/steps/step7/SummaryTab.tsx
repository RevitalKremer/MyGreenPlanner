import { useMemo, useState, useEffect } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { validateStrings } from '../../../services/projectsApi'
import {
  TEXT, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED,
  BORDER_FAINT, PANEL_LIGHT_BG, BLUE_BG,
  SUCCESS_BG, SUCCESS_DARK, ERROR_BG, ERROR_DARK, WARNING_BG, WARNING_DARK,
} from '../../../styles/colors'

// Distribution-to-inverters/strings table — per inverter, per MPPT input:
// string count, panels-per-string, DC/AC power and the DC:AC ratio.
export default function SummaryTab({ projectId, units, strings, panelWatt }: any) {
  const { t } = useLang()
  const W = panelWatt || 0

  // Validation problems — the same set shown in the Strings-plan tab.
  const [issues, setIssues] = useState<any[]>([])
  useEffect(() => {
    if (projectId && (strings || []).length) validateStrings(projectId, strings).then(r => setIssues(r.issues || [])).catch(() => setIssues([]))
    else setIssues([])
  }, [projectId, strings])
  const issueText = (it: any) => {
    const params = { ...(it.params || {}) }
    if (Array.isArray(params.specs)) params.specs = params.specs.join(', ')
    return t(`step7.issue.${it.code}`, params)
  }
  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')
  const data = useMemo(() => {
    let giBase = 0
    const unitsData = (units || []).map((u: any, ui: number) => {
      const portRows: any[] = []
      let unitPanels = 0
      for (let m = 0; m < u.mpptCount; m++) {
        const gi = giBase + m
        const ss = (strings || []).filter((s: any) => s.mpptIndex === gi)
        const panels = ss.reduce((a: number, s: any) => a + (s.panelIds?.length || 0), 0)
        unitPanels += panels
        portRows.push({ letter: String.fromCharCode(65 + m), nStrings: ss.length, perString: ss.map((s: any) => s.panelIds?.length || 0), panels })
      }
      giBase += u.mpptCount
      const dc = unitPanels * W / 1000
      const ac = u.kw || 0
      return { u, ui, portRows, unitPanels, dc, ac, ratio: ac > 0 ? dc / ac * 100 : null }
    })
    const totalPanels = unitsData.reduce((a: number, d: any) => a + d.unitPanels, 0)
    const totalAC = unitsData.reduce((a: number, d: any) => a + d.ac, 0)
    const totalDC = totalPanels * W / 1000
    return {
      unitsData, totalPanels, totalStrings: (strings || []).length, totalAC, totalDC,
      totalRatio: totalAC > 0 ? totalDC / totalAC * 100 : null,
    }
  }, [units, strings, W])

  if (!units?.length || !(strings || []).length) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: TEXT_MUTED, fontSize: '0.9rem' }}>{t('step7.dist.empty')}</div>
  }

  const kva = (v: number) => `${v.toFixed(2)} kVA`
  const kwp = (v: number) => `${v.toFixed(2)} kWp`
  const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`)
  const cell: React.CSSProperties = { border: `1px solid ${BORDER_FAINT}`, padding: '0.35rem 0.6rem', textAlign: 'center', fontSize: '0.82rem', color: TEXT }
  const th: React.CSSProperties = { ...cell, background: PANEL_LIGHT_BG, fontWeight: 700, color: TEXT_DARK }
  const merged: React.CSSProperties = { ...cell, fontWeight: 600 }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '1.5rem' }}>
      {/* summary header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        {[
          [t('step7.dist.panelWatt'), `${W} W`],
          [t('step7.dist.totalPanels'), data.totalPanels],
          [t('step7.dist.totalAc'), kva(data.totalAC)],
          [t('step7.dist.totalDc'), kwp(data.totalDC)],
          [t('step7.dist.ratio'), pct(data.totalRatio)],
        ].map(([label, val], i) => (
          <div key={i} style={{ background: BLUE_BG, borderRadius: 6, padding: '0.45rem 0.7rem', minWidth: 110 }}>
            <div style={{ fontSize: '0.68rem', color: TEXT_SECONDARY }}>{label}</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: TEXT_DARK }}>{val}</div>
          </div>
        ))}
      </div>

      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 900 }}>
        <thead>
          <tr>
            <th style={th}>{t('step7.dist.inverter')}</th>
            <th style={th}>{t('step7.dist.type')}</th>
            <th style={th}>{t('step7.dist.mppt')}</th>
            <th style={th}>{t('step7.dist.strings')}</th>
            <th style={th}>{t('step7.dist.perString')}</th>
            <th style={th}>{t('step7.dist.panels')}</th>
            <th style={th}>{t('step7.dist.dc')}</th>
            <th style={th}>{t('step7.dist.ac')}</th>
            <th style={th}>{t('step7.dist.acdc')}</th>
          </tr>
        </thead>
        <tbody>
          {data.unitsData.map((d: any) => d.portRows.map((pr: any, ri: number) => (
            <tr key={`${d.ui}-${ri}`}>
              {ri === 0 && <td style={merged} rowSpan={d.portRows.length}>{`INV ${d.ui + 1}`}</td>}
              {ri === 0 && <td style={merged} rowSpan={d.portRows.length}>{d.u.name}</td>}
              <td style={cell}>{pr.letter}</td>
              <td style={cell}>{pr.nStrings}</td>
              <td style={cell}>{pr.perString.join(', ') || '—'}</td>
              <td style={cell}>{pr.panels}</td>
              {ri === 0 && <td style={merged} rowSpan={d.portRows.length}>{kwp(d.dc)}</td>}
              {ri === 0 && <td style={merged} rowSpan={d.portRows.length}>{kva(d.ac)}</td>}
              {ri === 0 && <td style={merged} rowSpan={d.portRows.length}>{pct(d.ratio)}</td>}
            </tr>
          )))}
          <tr>
            <td style={{ ...th, textAlign: 'center' }} colSpan={3}>{t('step7.dist.total')}</td>
            <td style={th}>{data.totalStrings}</td>
            <td style={th} />
            <td style={th}>{data.totalPanels}</td>
            <td style={th}>{kwp(data.totalDC)}</td>
            <td style={th}>{kva(data.totalAC)}</td>
            <td style={th}>{pct(data.totalRatio)}</td>
          </tr>
        </tbody>
      </table>

      {/* validation problems — same set as the Strings-plan tab */}
      <div style={{ maxWidth: 900, marginTop: '1.25rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: TEXT_MUTED, marginBottom: '0.5rem' }}>{t('step7.issuesHeading')}</div>
        {errors.length === 0 && warnings.length === 0 ? (
          <div style={{ background: SUCCESS_BG, color: SUCCESS_DARK, borderRadius: 6, padding: '0.5rem 0.8rem', fontSize: '0.82rem' }}>{t('step7.valid')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {errors.map((it, i) => (<div key={`e${i}`} style={{ background: ERROR_BG, color: ERROR_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.82rem' }}>{issueText(it)}</div>))}
            {warnings.map((it, i) => (<div key={`w${i}`} style={{ background: WARNING_BG, color: WARNING_DARK, borderRadius: 6, padding: '0.5rem 0.7rem', fontSize: '0.82rem' }}>{issueText(it)}</div>))}
          </div>
        )}
      </div>
    </div>
  )
}
