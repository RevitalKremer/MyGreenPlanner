import { useState } from 'react'
import CrossSectionDiagram from './CrossSectionDiagram'

export default function CrossSectionPanel({
  projectMode, dg, areas, diagramGroupId, setDiagramGroupId,
  diagAngle, diagFrontH, diagBackH, diagLPR, diagOrients,
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div style={{
      position: 'absolute', top: '20px', left: '20px',
      width: collapsed ? '32px' : '340px', minHeight: '36px', overflow: 'hidden',
      maxHeight: collapsed ? 'none' : 'calc(100vh - 120px)', overflowY: collapsed ? 'hidden' : 'auto',
      padding: '1.25rem', background: 'white', borderRadius: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)', border: '2px solid #C4D600',
      display: 'flex', flexDirection: 'column'
    }}>
      <button onClick={() => setCollapsed(c => !c)} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', padding: 0, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {collapsed ? '›' : '‹'}
      </button>
      {!collapsed && (
        <>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: '600', color: '#555' }}>
            Row Cross-Section
            {projectMode === 'plan' && dg && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: dg.color, fontWeight: '700' }}>— {dg.label}</span>
            )}
          </h4>

          {projectMode === 'plan' && areas.length > 1 && (
            <select
              value={diagramGroupId ?? areas[0]?.id ?? ''}
              onChange={e => setDiagramGroupId(Number(e.target.value))}
              style={{ marginBottom: '0.6rem', padding: '0.4rem', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.82rem' }}
            >
              {areas.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          )}

          <CrossSectionDiagram
            angle={diagAngle} frontHeight={diagFrontH} backHeight={diagBackH}
            linesPerRow={diagLPR} orientations={diagOrients} projectMode={projectMode}
          />
        </>
      )}
    </div>
  )
}
