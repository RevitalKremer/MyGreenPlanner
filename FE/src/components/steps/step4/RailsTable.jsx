import { useState } from 'react'
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

export default function RailsTable({ rails, rowIdx }) {
  const [expanded, setExpanded] = useState(false)
  if (!rails || rails.length === 0) return null

  const totalLengthMm = rails.reduce((s, r) => s + r.lengthMm, 0)
  const totalPieces   = rails.reduce((s, r) => s + r.stockSegments.length, 0)
  const totalLeftover = rails.reduce((s, r) => s + r.leftoverMm, 0)
  const tdBase = { padding: '0.3rem 0.5rem' }

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.68rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
        Row {rowIdx + 1}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr style={{ background: BG_SUBTLE }}>
            <th style={{ ...tdBase, width: '28px' }} />
            {['Rail', 'Line', 'Type', 'Length (mm)', 'Stock pieces', 'Leftover (mm)'].map(h => (
              <th key={h} style={{ ...tdBase, textAlign: 'left', fontWeight: '700', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr onClick={() => setExpanded(e => !e)} style={{ borderTop: `1px solid ${BORDER_LIGHT}`, background: PRIMARY_BG, cursor: 'pointer' }}>
            <td style={{ ...tdBase, textAlign: 'center', fontSize: '0.7rem', color: TEXT_PLACEHOLDER }}>{expanded ? '▾' : '▸'}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT }}>Total</td>
            <td style={{ ...tdBase, color: TEXT_SECONDARY }}>—</td>
            <td style={{ ...tdBase, color: TEXT_SECONDARY }}>—</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT_DARKEST }}>{fmt(totalLengthMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT }}>{totalPieces} pcs</td>
            <td style={{ ...tdBase, fontWeight: '700', color: totalLeftover > 0 ? AMBER_DARK : TEXT_MUTED }}>{fmt(totalLeftover)}</td>
          </tr>
          {expanded && rails.map((rail, i) => (
            <tr key={rail.railId} style={{ borderTop: `1px solid ${BG_MID}`, background: i % 2 === 0 ? 'white' : BG_FAINT }}>
              <td style={tdBase} />
              <td style={{ ...tdBase, fontWeight: '600', color: TEXT_SECONDARY }}>{rail.railId}</td>
              <td style={{ ...tdBase, color: TEXT_MUTED }}>L{rail.lineIdx + 1}</td>
              <td style={{ ...tdBase, color: TEXT_MUTED }}>{rail.orientation}</td>
              <td style={{ ...tdBase, color: TEXT }}>{fmt(rail.lengthMm)}</td>
              <td style={{ ...tdBase, color: TEXT }}>{formatStockPieces(rail.stockSegments)}</td>
              <td style={{ ...tdBase, color: rail.leftoverMm > 0 ? AMBER_DARK : TEXT_VERY_LIGHT }}>{fmt(rail.leftoverMm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
