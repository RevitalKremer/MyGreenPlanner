import { PRIMARY } from '../../styles/colors'

/**
 * A clickable value in an admin table that cross-navigates to another admin
 * view. Renders the value in primary color with a small ↗ affordance, so all
 * cross-links look consistent.
 */
export default function LinkCell({ onClick, title, children }: { onClick: () => void; title?: string; children: any }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        background: 'none', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
        color: PRIMARY, font: 'inherit', display: 'inline-flex', alignItems: 'center', gap: '0.22rem',
        maxWidth: '100%',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
      </svg>
    </button>
  )
}
