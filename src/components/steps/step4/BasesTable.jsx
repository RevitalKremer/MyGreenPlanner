import { useState } from 'react'
import { fmt } from './tabUtils'

export default function BasesTable({ bp, rowIdx }) {
  const [expanded, setExpanded] = useState(false)
  if (!bp) return null
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
            {['Frame Length (mm)', 'Bases', 'Edge Offset (mm)', 'Spacing (mm)', 'Last Gap (mm)'].map(h => (
              <th key={h} style={{ ...tdBase, textAlign: 'left', fontWeight: '700', color: '#555', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr onClick={() => setExpanded(e => !e)} style={{ borderTop: '1px solid #e0e0e0', background: '#f8fce8', cursor: 'pointer' }}>
            <td style={{ ...tdBase, textAlign: 'center', fontSize: '0.7rem', color: '#888' }}>{expanded ? '▾' : '▸'}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#333' }}>{fmt(bp.frameLengthMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: '#222' }}>{bp.baseCount}</td>
            <td style={{ ...tdBase, color: '#555' }}>{fmt(bp.edgeOffsetMm)}</td>
            <td style={{ ...tdBase, color: '#555' }}>{fmt(bp.spacingMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: bp.lastGapMm > bp.spacingMm * 0.5 ? '#b45309' : '#666' }}>{fmt(bp.lastGapMm)}</td>
          </tr>
          {expanded && bp.bases.map((base, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={tdBase} />
              <td style={{ ...tdBase, fontWeight: '600', color: '#444' }}>B{i + 1}</td>
              <td style={{ ...tdBase, color: '#666' }} colSpan={4}>{fmt(base.offsetFromStartMm)} mm from left edge</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
