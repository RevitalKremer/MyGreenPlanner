import { useState } from 'react'
import { useLang } from '../../../i18n/LangContext'
import { TEXT, TEXT_SECONDARY, TEXT_DARKEST, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_MUTED, BORDER_LIGHT, BG_SUBTLE, BG_FAINT, BG_MID, PRIMARY_BG, AMBER_DARK } from '../../../styles/colors'
import { fmt } from './tabUtils'

function formatStockPieces(segments) {
  const groups = []
  for (const mm of segments) {
    const last = groups[groups.length - 1]
    if (last && last.mm === mm) last.count++
    else groups.push({ mm, count: 1 })
  }
  return groups.map(g => g.count > 1 ? `${g.count}×${fmt(g.mm)}mm` : `${fmt(g.mm)}mm`).join(' + ')
}

export default function RailsTable({ areaLabel, rails }) {
  const { t } = useLang()
  const [expanded, setExpanded] = useState(false)
  if (!rails || rails.length === 0) return null

  const totalLengthMm = Math.round(rails.reduce((s, r) => s + (r.roundedLengthCm ?? r.lengthCm), 0) * 10)
  const totalPieces   = rails.reduce((s, r) => s + r.stockSegmentsMm.length, 0)
  const totalLeftoverMm = Math.round(rails.reduce((s, r) => s + r.leftoverCm, 0) * 10)
  const tdBase = { padding: '0.3rem 0.5rem' }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
        {areaLabel ?? t('step3.label.area', { n: '' })}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr style={{ background: BG_SUBTLE }}>
            <th style={{ ...tdBase, width: '28px' }} />
            {[t('step3.rails.colPanelLine'), t('step3.rails.colLength'), t('step3.rails.colStock'), t('step3.rails.colLeftover')].map(h => (
              <th key={h} style={{ ...tdBase, textAlign: 'left', fontWeight: '700', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr onClick={() => setExpanded(e => !e)} style={{ borderTop: `1px solid ${BORDER_LIGHT}`, background: PRIMARY_BG, cursor: 'pointer' }}>
            <td style={{ ...tdBase, textAlign: 'center', fontSize: '0.7rem', color: TEXT_PLACEHOLDER }}>{expanded ? '▾' : '▸'}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT }}>{t('step3.rails.total')}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT_DARKEST }}>{fmt(totalLengthMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT }}>{t('step3.rails.pcs', { n: totalPieces })}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: totalLeftoverMm > 0 ? AMBER_DARK : TEXT_MUTED }}>{fmt(totalLeftoverMm)}</td>
          </tr>
          {expanded && rails.map((rail, i) => (
            <tr key={rail.railId} style={{ borderTop: `1px solid ${BG_MID}`, background: i % 2 === 0 ? 'white' : BG_FAINT }}>
              <td style={tdBase} />
              <td style={{ ...tdBase, color: TEXT_MUTED }}>#{rail.lineIdx + 1}</td>
              <td style={{ ...tdBase, color: TEXT }}>{fmt(Math.round((rail.roundedLengthCm ?? rail.lengthCm) * 10))}</td>
              <td style={{ ...tdBase, color: TEXT }}>{formatStockPieces(rail.stockSegmentsMm)}</td>
              <td style={{ ...tdBase, color: rail.leftoverCm > 0 ? AMBER_DARK : TEXT_VERY_LIGHT }}>{fmt(Math.round(rail.leftoverCm * 10))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
