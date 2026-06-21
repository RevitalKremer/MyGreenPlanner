import React from 'react'
import { TEXT_DARKEST, TEXT_DARK, TEXT_LIGHT, PRIMARY, TEXT, BORDER_FAINT } from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

/**
 * Read-only viewer for the Terms of Use / Privacy Policy.
 * view: 'terms' | 'privacy' — picks which i18n body to render.
 * Renders above AuthModal (z-index 1100 > 1000).
 *
 * Body strings live in i18n under `<view>.body`. Lines that end with ':' and
 * carry no other punctuation are treated as section headings; blank lines
 * become paragraph breaks.
 */
export default function LegalModal({ view, onClose }) {
  const { t } = useLang()
  const title = t(`${view}.title`)
  const body = t(`${view}.body`)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }} onClick={onClose}>
      <div style={{
        background: 'white', borderRadius: '16px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
        width: '100%', maxWidth: '640px', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        position: 'relative',
      }} onClick={e => e.stopPropagation()}>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.25rem 1.5rem', borderBottom: `2px solid ${BORDER_FAINT}`,
        }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: TEXT_DARKEST }}>{title}</div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1.3rem', color: TEXT_LIGHT, lineHeight: 1,
          }}>×</button>
        </div>

        <div style={{
          padding: '1.25rem 1.5rem', overflowY: 'auto',
          fontSize: '0.86rem', lineHeight: 1.65, color: TEXT_DARK,
        }}>
          {body.split('\n').map((line, i) => {
            const trimmed = line.trim()
            if (!trimmed) return <div key={i} style={{ height: '0.6rem' }} />
            const isHeading = /:$/.test(trimmed) && trimmed.length < 80
            return (
              <div key={i} style={isHeading
                ? { fontWeight: 700, color: TEXT_DARKEST, margin: '0.6rem 0 0.2rem' }
                : { marginBottom: '0.15rem' }}>
                {trimmed}
              </div>
            )
          })}
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: `1px solid ${BORDER_FAINT}` }}>
          <button onClick={onClose} style={{
            width: '100%', padding: '0.7rem',
            background: PRIMARY, color: TEXT,
            border: 'none', borderRadius: '8px',
            cursor: 'pointer', fontWeight: 700, fontSize: '0.92rem',
          }}>
            {t('legal.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
