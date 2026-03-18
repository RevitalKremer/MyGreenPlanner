import { useMemo } from 'react'
import { buildBOM } from '../../../utils/constructionCalculator'

export default function BOMView({ rowConstructions }) {
  const bom = useMemo(() => buildBOM(rowConstructions), [rowConstructions])
  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>Bill of Materials</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
        <thead>
          <tr style={{ background: '#f5f5f5' }}>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Element</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Length (cm)</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Qty</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: '700', color: '#444' }}>Total (cm)</th>
          </tr>
        </thead>
        <tbody>
          {bom.map((item, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f0f0', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <td style={{ padding: '0.4rem 0.75rem', color: '#333' }}>{item.type}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#555' }}>{item.lengthCm.toFixed(1)}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '700', color: '#222' }}>{item.quantity}</td>
              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', fontWeight: '600', color: '#5a6600' }}>{(item.lengthCm * item.quantity / 100).toFixed(2)} m</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f0f0f0', fontWeight: '700' }}>
            <td colSpan={3} style={{ padding: '0.4rem 0.75rem', color: '#333' }}>Total linear meters</td>
            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#222' }}>
              {(bom.reduce((s, r) => s + r.lengthCm * r.quantity, 0) / 100).toFixed(2)} m
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
