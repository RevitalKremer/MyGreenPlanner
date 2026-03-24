import { useState } from 'react'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_DARK, TEXT_SECONDARY, TEXT_LIGHT,
  TEXT_VERY_LIGHT, BORDER_LIGHT, BORDER_FAINT, ERROR, ERROR_BG, SUCCESS, SUCCESS_BG,
} from '../../styles/colors'

const inputStyle = (focused) => ({
  width: '100%', padding: '0.65rem 0.8rem', boxSizing: 'border-box',
  border: `1.5px solid ${focused ? TEXT_DARK : BORDER_LIGHT}`,
  borderRadius: '8px', fontSize: '0.92rem', outline: 'none',
  transition: 'border-color 0.15s',
})

/**
 * mode: 'login' | 'register' | 'forgot' | 'reset' | 'registered'
 * resetToken: string — pre-fill the reset flow from URL param
 */
export default function AuthModal({ onClose, onSuccess, onForgotPassword, onResetPassword, defaultTab = 'login', resetToken = null }) {
  const [mode, setMode] = useState(resetToken ? 'reset' : defaultTab)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(null)

  const switchMode = (m) => { setMode(m); setError(null); setInfo(null) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setLoading(true)
    try {
      if (mode === 'login') {
        await onSuccess('login', email, password)
      } else if (mode === 'register') {
        await onSuccess('register', email, password, fullName, phone)
        setMode('registered')
      } else if (mode === 'forgot') {
        await onForgotPassword(email)
        setInfo('If that email is registered, a reset link has been sent. Check your inbox.')
      } else if (mode === 'reset') {
        if (newPassword !== confirmPassword) throw new Error('Passwords do not match')
        await onResetPassword(resetToken, newPassword)
        setInfo('Password updated successfully. You can now sign in.')
        setTimeout(() => switchMode('login'), 2000)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'white', borderRadius: '16px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        width: '100%', maxWidth: '400px', padding: '2rem',
        position: 'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: '1rem', right: '1rem',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '1.3rem', color: TEXT_LIGHT, lineHeight: 1,
        }}>×</button>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <img src="/mgp-logo.svg" alt="MyGreenPlanner" style={{ height: '48px' }} />
        </div>

        {/* ── Post-registration success ──────────────────────────── */}
        {mode === 'registered' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📧</div>
            <div style={{ fontSize: '1rem', fontWeight: '700', color: TEXT_DARKEST, marginBottom: '0.5rem' }}>
              Check your email!
            </div>
            <div style={{ fontSize: '0.85rem', color: TEXT_LIGHT, lineHeight: 1.6, marginBottom: '1.5rem' }}>
              We sent a verification link to <strong>{email}</strong>.<br />
              Click it to activate your account.
            </div>
            <button onClick={onClose} style={{
              width: '100%', padding: '0.75rem',
              background: PRIMARY, color: TEXT,
              border: 'none', borderRadius: '8px',
              cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem',
            }}>
              Got it
            </button>
            <button onClick={() => switchMode('login')} style={{
              marginTop: '0.75rem', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.82rem', color: TEXT_LIGHT, textDecoration: 'underline',
            }}>
              Sign in instead
            </button>
          </div>
        )}

        {/* ── Forgot password ──────────────────────────────────────── */}
        {mode === 'forgot' && (
          <>
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '1rem', fontWeight: '700', color: TEXT_DARKEST, marginBottom: '0.3rem' }}>Forgot password?</div>
              <div style={{ fontSize: '0.82rem', color: TEXT_LIGHT }}>Enter your email and we'll send a reset link.</div>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>Email</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')} onBlur={() => setFocused(null)}
                  placeholder="you@example.com" required autoFocus
                  style={inputStyle(focused === 'email')}
                />
              </div>
              {error && <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: ERROR_BG, borderRadius: '8px', fontSize: '0.83rem', color: ERROR }}>{error}</div>}
              {info  && <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: SUCCESS_BG, borderRadius: '8px', fontSize: '0.83rem', color: SUCCESS }}>{info}</div>}
              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '0.75rem',
                background: loading ? BORDER_LIGHT : PRIMARY, color: loading ? TEXT_VERY_LIGHT : TEXT,
                border: 'none', borderRadius: '8px', cursor: loading ? 'default' : 'pointer',
                fontWeight: '700', fontSize: '0.95rem', transition: 'background 0.15s',
              }}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
            <button onClick={() => switchMode('login')} style={{
              marginTop: '1rem', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.82rem', color: TEXT_LIGHT, textDecoration: 'underline', padding: 0,
            }}>
              ← Back to Sign In
            </button>
          </>
        )}

        {/* ── Reset password ───────────────────────────────────────── */}
        {mode === 'reset' && (
          <>
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '1rem', fontWeight: '700', color: TEXT_DARKEST, marginBottom: '0.3rem' }}>Set new password</div>
              <div style={{ fontSize: '0.82rem', color: TEXT_LIGHT }}>Choose a new password for your account.</div>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>New Password</label>
                <input
                  type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  onFocus={() => setFocused('new')} onBlur={() => setFocused(null)}
                  placeholder="••••••••" required autoFocus
                  style={inputStyle(focused === 'new')}
                />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>Confirm Password</label>
                <input
                  type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  onFocus={() => setFocused('confirm')} onBlur={() => setFocused(null)}
                  placeholder="••••••••" required
                  style={inputStyle(focused === 'confirm')}
                />
              </div>
              {error && <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: ERROR_BG, borderRadius: '8px', fontSize: '0.83rem', color: ERROR }}>{error}</div>}
              {info  && <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: SUCCESS_BG, borderRadius: '8px', fontSize: '0.83rem', color: SUCCESS }}>{info}</div>}
              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '0.75rem',
                background: loading ? BORDER_LIGHT : PRIMARY, color: loading ? TEXT_VERY_LIGHT : TEXT,
                border: 'none', borderRadius: '8px', cursor: loading ? 'default' : 'pointer',
                fontWeight: '700', fontSize: '0.95rem', transition: 'background 0.15s',
              }}>
                {loading ? 'Saving…' : 'Set New Password'}
              </button>
            </form>
          </>
        )}

        {/* ── Login / Register tabs ────────────────────────────────── */}
        {(mode === 'login' || mode === 'register') && (
          <>
            <div style={{ display: 'flex', borderBottom: `2px solid ${BORDER_FAINT}`, marginBottom: '1.5rem' }}>
              {['login', 'register'].map(t => (
                <button key={t} onClick={() => switchMode(t)} style={{
                  flex: 1, padding: '0.6rem', background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: '0.9rem', fontWeight: mode === t ? '700' : '500',
                  color: mode === t ? TEXT_DARKEST : TEXT_LIGHT,
                  borderBottom: `2px solid ${mode === t ? TEXT_DARKEST : 'transparent'}`,
                  marginBottom: '-2px', transition: 'all 0.15s',
                }}>
                  {t === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit}>
              {mode === 'register' && (
                <>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                      Full Name <span style={{ color: ERROR }}>*</span>
                    </label>
                    <input
                      type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                      onFocus={() => setFocused('name')} onBlur={() => setFocused(null)}
                      placeholder="Your full name" required style={inputStyle(focused === 'name')}
                    />
                  </div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                      Phone Number
                    </label>
                    <input
                      type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                      onFocus={() => setFocused('phone')} onBlur={() => setFocused(null)}
                      placeholder="+972 50 000 0000" style={inputStyle(focused === 'phone')}
                    />
                  </div>
                </>
              )}

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>Email</label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  onFocus={() => setFocused('email')} onBlur={() => setFocused(null)}
                  placeholder="you@example.com" required autoFocus
                  style={inputStyle(focused === 'email')}
                />
              </div>

              <div style={{ marginBottom: mode === 'login' ? '0.5rem' : '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>Password</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocused('pass')} onBlur={() => setFocused(null)}
                  placeholder="••••••••" required style={inputStyle(focused === 'pass')}
                />
              </div>

              {mode === 'login' && (
                <div style={{ marginBottom: '1.25rem', textAlign: 'right' }}>
                  <button type="button" onClick={() => switchMode('forgot')} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '0.78rem', color: TEXT_LIGHT, textDecoration: 'underline', padding: 0,
                  }}>
                    Forgot password?
                  </button>
                </div>
              )}

              {error && <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: ERROR_BG, borderRadius: '8px', fontSize: '0.83rem', color: ERROR }}>{error}</div>}

              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '0.75rem',
                background: loading ? BORDER_LIGHT : PRIMARY, color: loading ? TEXT_VERY_LIGHT : TEXT,
                border: 'none', borderRadius: '8px', cursor: loading ? 'default' : 'pointer',
                fontWeight: '700', fontSize: '0.95rem', transition: 'background 0.15s',
              }}>
                {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
