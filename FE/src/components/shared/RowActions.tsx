import { TEXT_SECONDARY, DANGER } from '../../styles/colors'

// Shared edit/delete row-action icons, so every admin table uses the same pair.
// `onEdit` is optional — omit it for a delete-only action.
export default function RowActions({ onEdit, onDelete, editTitle, deleteTitle }: {
  onEdit?: () => void
  onDelete: () => void
  editTitle?: string
  deleteTitle?: string
}) {
  const btn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem', display: 'inline-flex', alignItems: 'center' }
  return (
    <div style={{ display: 'flex', gap: '0.25rem' }}>
      {onEdit && (
        <button onClick={onEdit} title={editTitle} style={{ ...btn, color: TEXT_SECONDARY }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
        </button>
      )}
      <button onClick={onDelete} title={deleteTitle} style={{ ...btn, color: DANGER }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
      </button>
    </div>
  )
}
