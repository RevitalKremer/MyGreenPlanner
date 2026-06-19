import { useState } from 'react'
import { AMBER_DARK, AMBER_BG, AMBER_BORDER } from '../styles/colors'
import { useLang } from '../i18n/LangContext'

/**
 * Amber strip shown to logged-in, unverified users prompting them to verify
 * their email (so they receive their free credits). Renders nothing when the
 * user is absent or already verified. Used in the app header and the welcome
 * screen. `onResend` re-sends the verification email.
 */
export default function VerifyBanner({ user, onResend = null }) {
  const { t } = useLang()
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  if (!user || user.is_verified) return null

  const resend = async () => {
    if (!onResend) return
    setSending(true)
    try { await onResend(); setSent(true) }
    catch { /* keep it quiet */ }
    finally { setSending(false) }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
      gap: '0.6rem', padding: '0.5rem 1rem',
      background: AMBER_BG, color: AMBER_DARK, borderBottom: `1px solid ${AMBER_BORDER}`,
      fontSize: '0.82rem', fontWeight: 600,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>{t('verify.banner')}</span>
      {onResend && (sent
        ? <span style={{ fontWeight: 700 }}>{t('verify.sent')}</span>
        : <button
            onClick={resend}
            disabled={sending}
            style={{ background: 'none', border: `1px solid ${AMBER_BORDER}`, borderRadius: 6, padding: '0.2rem 0.7rem', cursor: sending ? 'default' : 'pointer', color: AMBER_DARK, fontWeight: 700, fontSize: '0.78rem' }}
          >{sending ? t('verify.sending') : t('verify.resend')}</button>
      )}
    </div>
  )
}
