import { useState } from 'react'

/**
 * Floating collapsible layers/visibility toggle panel (top-right of canvas).
 * layers: [{ label, checked, setter }]
 * summary: optional JSX shown at the bottom when expanded
 * actions: optional [{ label, onClick, style }] buttons shown below summary
 */
export default function LayersPanel({ layers, summary, actions }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      style={{ position: 'absolute', top: '16px', right: '16px', zIndex: 10, width: collapsed ? '36px' : '160px', background: 'white', borderRadius: '10px', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', border: '1px solid #e0e0e0', overflow: 'hidden', transition: 'width 0.18s' }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.65rem', cursor: 'pointer', background: '#fafafa', borderBottom: collapsed ? 'none' : '1px solid #f0f0f0' }}
      >
        {!collapsed && <span style={{ fontSize: '0.68rem', fontWeight: '700', color: '#555', whiteSpace: 'nowrap' }}>Layers</span>}
        <span style={{ fontSize: '0.75rem', color: '#aaa', marginLeft: 'auto' }}>{collapsed ? '◀' : '▶'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '0.6rem 0.75rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: summary ? '0.6rem' : 0 }}>
            {layers.map(({ label, checked, setter }) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.79rem', color: checked ? '#333' : '#aaa', fontWeight: '500' }}>
                <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)} style={{ accentColor: '#2b6a99', cursor: 'pointer', width: '13px', height: '13px' }} />
                {label}
              </label>
            ))}
          </div>
          {summary && (
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '0.5rem', fontSize: '0.73rem', color: '#888' }}>
              {summary}
            </div>
          )}
          {actions?.length > 0 && (
            <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              {actions.map(({ label, onClick, style: btnStyle }) => (
                <button key={label} onClick={onClick} style={{ padding: '0.22rem 0.4rem', fontSize: '0.62rem', fontWeight: '600', borderRadius: '4px', cursor: 'pointer', ...btnStyle }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
