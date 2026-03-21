import { useMemo } from 'react'
import { TEXT, TEXT_SECONDARY, TEXT_DARKEST, TEXT_VERY_LIGHT, BG_SUBTLE, BG_MID, PRIMARY_DARK } from '../../../styles/colors'
import { buildBOM } from '../../../utils/constructionCalculator'

export default function BOMView({ rowConstructions }) {
  const bom = useMemo(() => buildBOM(rowConstructions), [rowConstructions])
  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>Bill of Materials</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
        <thead>
          <tr style={{ background: BG_SUBTLE }}>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: '700', color: TEXT_SECONDARY }}>Element</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: TEXT_SECONDARY }}>Length (cm)</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: TEXT_SECONDARY }}>Qty</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: TEXT_SECONDARY }}>Total (cm)</th>
          </tr>
        </thead>
        <tbody>
          {bom.map((item, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${BG_MID}`, background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={{ padding: '0.4rem 0.75rem', color: TEXT }}>{item.type}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: TEXT_SECONDARY }}>{item.lengthCm.toFixed(1)}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '700', color: TEXT_DARKEST }}>{item.quantity}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '600', color: PRIMARY_DARK }}>{(item.lengthCm * item.quantity / 100).toFixed(2)} m</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: BG_MID, fontWeight: '700' }}>
            <td colSpan={3} style={{ padding: '0.4rem 0.75rem', color: TEXT }}>Total linear meters</td>
            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: TEXT_DARKEST }}>
              {(bom.reduce((s, r) => s + r.lengthCm * r.quantity, 0) / 100).toFixed(2)} m
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
