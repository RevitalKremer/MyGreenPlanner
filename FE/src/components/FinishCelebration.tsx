import { useEffect, useMemo } from 'react'
import { useLang } from '../i18n/LangContext'
import { PRIMARY, PRIMARY_DARK, PRIMARY_MID, PRIMARY_BG, SUCCESS, SUCCESS_DARK, WHITE, TEXT_DARKEST } from '../styles/colors'

// One-shot celebration modal shown when the user clicks Finish on step 5.
// Closing the modal returns to the welcome screen (same as Start Over) —
// the project was already saved by the time they got here, so we don't
// need an "are you sure" prompt.
export default function FinishCelebration({ open, onDone }) {
  const { t } = useLang()

  // ESC closes too — feels natural for a celebratory dialog.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onDone() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onDone])

  // 30 random confetti pieces that fall and rotate. Brand-only palette so
  // the celebration stays on-brand (no rainbow / sunburst stuff).
  const BRAND_PALETTE = [PRIMARY, PRIMARY_DARK, PRIMARY_MID, SUCCESS, SUCCESS_DARK, PRIMARY_BG]
  const pieces = useMemo(() => Array.from({ length: 30 }).map((_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    dur: 2 + Math.random() * 1.5,
    rot: Math.random() * 360,
    color: BRAND_PALETTE[i % BRAND_PALETTE.length],
    shape: i % 3,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [])

  if (!open) return null

  return (
    <>
      <style>{`
        @keyframes finish-confetti-fall {
          0%   { transform: translateY(-110vh) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(110vh)  rotate(720deg); opacity: 0.7; }
        }
        @keyframes finish-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        onClick={onDone}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'finish-fade-in 0.25s ease-out',
          overflow: 'hidden',
        }}
      >
        {pieces.map((p, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: 0,
              left: `${p.left}%`,
              width:  p.shape === 0 ? '10px' : p.shape === 1 ? '8px' : '14px',
              height: p.shape === 0 ? '14px' : p.shape === 1 ? '8px' : '6px',
              background: p.color,
              borderRadius: p.shape === 1 ? '50%' : '2px',
              animation: `finish-confetti-fall ${p.dur}s linear ${p.delay}s infinite`,
              transform: `rotate(${p.rot}deg)`,
            }}
          />
        ))}

        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative', zIndex: 2,
            background: WHITE,
            borderTop: `4px solid ${PRIMARY}`,
            borderRadius: '14px',
            padding: '2.25rem 2.75rem 2rem',
            boxShadow: '0 18px 48px rgba(0,0,0,0.28)',
            maxWidth: '480px', width: 'calc(100% - 2.5rem)',
            textAlign: 'center',
          }}
        >
          <h2 style={{
            margin: 0, fontSize: '1.6rem', fontWeight: 800,
            color: SUCCESS_DARK, letterSpacing: '-0.01em',
          }}>
            {t('finish.title')}
          </h2>

          <p style={{
            margin: '0.75rem 0 0', fontSize: '0.95rem', lineHeight: 1.45,
            color: TEXT_DARKEST,
          }}>
            {t('finish.message')}
          </p>

          <button
            onClick={onDone}
            style={{
              marginTop: '1.75rem',
              padding: '0.7rem 1.75rem',
              fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.02em',
              background: PRIMARY,
              color: PRIMARY_DARK,
              border: 'none', borderRadius: '8px',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = PRIMARY_MID }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = PRIMARY }}
          >
            {t('finish.backHome')}
          </button>
        </div>
      </div>
    </>
  )
}
