import { useState } from 'react'
import { TEXT, TEXT_SECONDARY, TEXT_DARKEST, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER, TEXT_MUTED, BORDER_LIGHT, BG_SUBTLE, BG_FAINT, BG_MID, PRIMARY_BG, AMBER_DARK } from '../../../styles/colors'
import { fmt } from './tabUtils'

export default function BasesTable({ bp, rowIdx }) {
  const [expanded, setExpanded] = useState(false)
  if (!bp) return null
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
            {['Frame Length (mm)', 'Bases', 'Edge Offset (mm)', 'Spacing (mm)', 'Last Gap (mm)'].map(h => (
              <th key={h} style={{ ...tdBase, textAlign: 'left', fontWeight: '700', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr onClick={() => setExpanded(e => !e)} style={{ borderTop: `1px solid ${BORDER_LIGHT}`, background: PRIMARY_BG, cursor: 'pointer' }}>
            <td style={{ ...tdBase, textAlign: 'center', fontSize: '0.7rem', color: TEXT_PLACEHOLDER }}>{expanded ? '▾' : '▸'}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT }}>{fmt(bp.frameLengthMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: TEXT_DARKEST }}>{bp.baseCount}</td>
            <td style={{ ...tdBase, color: TEXT_SECONDARY }}>{fmt(bp.edgeOffsetMm)}</td>
            <td style={{ ...tdBase, color: TEXT_SECONDARY }}>{fmt(bp.spacingMm)}</td>
            <td style={{ ...tdBase, fontWeight: '700', color: bp.lastGapMm > bp.spacingMm * 0.5 ? AMBER_DARK : TEXT_MUTED }}>{fmt(bp.lastGapMm)}</td>
          </tr>
          {expanded && bp.bases.map((base, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${BG_MID}`, background: i % 2 === 0 ? 'white' : BG_FAINT }}>
              <td style={tdBase} />
              <td style={{ ...tdBase, fontWeight: '600', color: TEXT_SECONDARY }}>B{i + 1}</td>
              <td style={{ ...tdBase, color: '#666' }} colSpan={4}>{fmt(base.offsetFromStartMm)} mm from left edge</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
