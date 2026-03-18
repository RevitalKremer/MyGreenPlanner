import { useState } from 'react'
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
      <div style={{ fontSize: '0.68rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
        Row {rowIdx + 1}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={{ ...tdBase, width: '28px' }} />
            {['Rail', 'Line', 'Type', 'Length (mm)', 'Stock pieces', 'Leftover (mm)'].map(h => (
              <th key={h} style={{ ...tdBase, textAlign: 'left', fontWeight: '700', color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr onClick={() => setExpanded(e => !e)} style={{ borderTop: '1px solid #e0e0e0', background: '#f8fce8', cursor: 'pointer' }}>
            <td style={{ ...tdBase, textAlign: 'center', fontSize: '0.7rem', color: '#888' }}>{expanded ? '▾' : '▸'}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#333' }}>Total</td>
            <td style={{ ...tdBase, color: '#555' }}>—</td>
            <td style={{ ...tdBase, color: '#555' }}>—</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#222' }}>{fmt(totalLengthMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#333' }}>{totalPieces} pcs</td>
            <td style={{ ...tdBase, fontWeight: '700', color: totalLeftover > 0 ? '#b45309' : '#666' }}>{fmt(totalLeftover)}</td>
          </tr>
          {expanded && rails.map((rail, i) => (
            <tr key={rail.railId} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={tdBase} />
              <td style={{ ...tdBase, fontWeight: '600', color: '#444' }}>{rail.railId}</td>
              <td style={{ ...tdBase, color: '#666' }}>L{rail.lineIdx + 1}</td>
              <td style={{ ...tdBase, color: '#666' }}>{rail.orientation}</td>
              <td style={{ ...tdBase, color: '#333' }}>{fmt(rail.lengthMm)}</td>
              <td style={{ ...tdBase, color: '#333' }}>{formatStockPieces(rail.stockSegments)}</td>
              <td style={{ ...tdBase, color: rail.leftoverMm > 0 ? '#b45309' : '#aaa' }}>{fmt(rail.leftoverMm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
