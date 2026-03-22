import { useMemo } from 'react'
import { TEXT, TEXT_SECONDARY, TEXT_DARKEST, TEXT_MUTED, TEXT_VERY_LIGHT, TEXT_PLACEHOLDER,
  BG_SUBTLE, BG_FAINT, BG_MID, PRIMARY_DARK, BORDER_FAINT } from '../../../styles/colors'
import { buildBOM } from '../../../utils/constructionCalculator'

export default function BOMView({ rowConstructions, rowLabels = [] }) {
  const rows = useMemo(() => buildBOM(rowConstructions, rowLabels), [rowConstructions, rowLabels])

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
        Bill of Materials
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
        <thead>
          <tr style={{ background: BG_SUBTLE }}>
            <th style={{ textAlign: 'left',  padding: '0.4rem 0.6rem', fontWeight: '700', color: TEXT_SECONDARY, width: '2.5rem' }}>#</th>
            <th style={{ textAlign: 'left',  padding: '0.4rem 0.6rem', fontWeight: '700', color: TEXT_SECONDARY }}>Area / Sub-Area</th>
            <th style={{ textAlign: 'left',  padding: '0.4rem 0.6rem', fontWeight: '700', color: TEXT_SECONDARY }}>Element</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', fontWeight: '700', color: TEXT_SECONDARY }}>Length (m)</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', fontWeight: '700', color: TEXT_SECONDARY }}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isAreaStart = i === 0 || rows[i - 1].areaLabel !== row.areaLabel
            return (
              <tr key={i} style={{
                borderTop: isAreaStart && i > 0 ? `2px solid ${BG_MID}` : `1px solid ${BORDER_FAINT}`,
                background: i % 2 === 0 ? 'white' : BG_FAINT,
              }}>
                <td style={{ padding: '0.4rem 0.6rem', color: TEXT_PLACEHOLDER, fontSize: '0.75rem' }}>{i + 1}</td>
                <td style={{ padding: '0.4rem 0.6rem', color: TEXT_MUTED, fontWeight: isAreaStart ? '700' : '400' }}>
                  {isAreaStart ? row.areaLabel : ''}
                </td>
                <td style={{ padding: '0.4rem 0.6rem', color: TEXT, fontFamily: 'monospace', fontSize: '0.8rem' }}>{row.element}</td>
                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: TEXT_SECONDARY }}>
                  {row.totalLengthM != null ? row.totalLengthM.toFixed(2) : '—'}
                </td>
                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: '700', color: TEXT_DARKEST }}>{row.qty}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: BG_MID, fontWeight: '700' }}>
            <td colSpan={3} style={{ padding: '0.4rem 0.6rem', color: TEXT }}>Total linear meters (angle profile)</td>
            <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: PRIMARY_DARK }}>
              {rows.filter(r => r.element === 'angle_profile_40X40' || r.element === 'angle_profile_40X40_diag').reduce((s, r) => s + (r.totalLengthM ?? 0), 0).toFixed(2)} m
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
