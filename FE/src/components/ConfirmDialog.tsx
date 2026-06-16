import { BLACK, WHITE, PRIMARY, ERROR, ERROR_DARK, WARNING, WARNING_DARK, BORDER_LIGHT, TEXT, TEXT_DARK, TEXT_LIGHT } from '../styles/colors'

type Variant = 'default' | 'warning' | 'danger'

// fg  — title bar text colour
// bg  — confirm-button background
// btnFg — confirm-button foreground (contrasts against bg). Previously
//         the confirm button hardcoded '#fff' which collided with the
//         default variant's white background, leaving the label invisible.
const ACCENT: Record<Variant, { fg: string; bg: string; btnFg: string }> = {
  default: { fg: TEXT_DARK,    bg: PRIMARY, btnFg: TEXT },
  warning: { fg: WARNING_DARK, bg: WARNING, btnFg: WHITE },
  danger:  { fg: ERROR_DARK,   bg: ERROR,   btnFg: WHITE },
}

export default function ConfirmDialog({
  open, title, message,
  confirmLabel, cancelLabel, discardLabel,
  variant = 'default',
  onConfirm, onCancel, onDiscard,
}: {
  open: boolean
  title?: string
  message: string
  confirmLabel: string
  cancelLabel: string
  discardLabel?: string
  variant?: Variant
  onConfirm: () => void
  onCancel: () => void
  onDiscard?: () => void
}) {
  if (!open) return null
  const a = ACCENT[variant]
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(0,0,0,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '12px',
          minWidth: '20rem', maxWidth: '32rem', width: '90%',
          boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }}
      >
        {title && (
          <div style={{
            padding: '0.9rem 1.1rem', fontWeight: 700, fontSize: '1rem',
            color: a.fg, borderBottom: `1px solid ${BORDER_LIGHT}`,
            textAlign: 'center',
          }}>
            {title}
          </div>
        )}
        <div style={{
          padding: '1.1rem 1.1rem 0.6rem', color: BLACK, fontSize: '0.9rem', lineHeight: 1.45,
          textAlign: 'center',
        }}>
          {message}
        </div>
        <div style={{
          padding: '0.75rem 1.1rem 1rem', display: 'flex', justifyContent: 'center', gap: '0.5rem',
          flexWrap: 'wrap',
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '0.45rem 0.95rem', borderRadius: '7px',
              background: '#fff', color: TEXT_LIGHT,
              border: `1px solid ${BORDER_LIGHT}`, cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 600,
            }}
          >{cancelLabel}</button>
          {discardLabel && onDiscard && (
            <button
              onClick={onDiscard}
              style={{
                padding: '0.45rem 0.95rem', borderRadius: '7px',
                background: '#fff', color: ERROR_DARK,
                border: `1px solid ${ERROR}`, cursor: 'pointer',
                fontSize: '0.85rem', fontWeight: 600,
              }}
            >{discardLabel}</button>
          )}
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              padding: '0.45rem 0.95rem', borderRadius: '7px',
              background: a.bg, color: a.btnFg,
              border: `1px solid ${a.bg}`, cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 700,
            }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
