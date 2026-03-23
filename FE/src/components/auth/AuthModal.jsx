import { useState } from 'react'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_DARK, TEXT_SECONDARY, TEXT_LIGHT,
  TEXT_VERY_LIGHT, BORDER_LIGHT, BORDER_FAINT, ERROR, ERROR_BG,
} from '../../styles/colors'

const inputStyle = (focused) => ({
  width: '100%', padding: '0.65rem 0.8rem', boxSizing: 'border-box',
  border: `1.5px solid ${focused ? TEXT_DARK : BORDER_LIGHT}`,
  borderRadius: '8px', fontSize: '0.92rem', outline: 'none',
  transition: 'border-color 0.15s',
})

export default function AuthModal({ onClose, onSuccess, defaultTab = 'login' }) {
  const [tab, setTab] = useState(defaultTab)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await onSuccess(tab, email, password, fullName, phone)
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

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `2px solid ${BORDER_FAINT}`, marginBottom: '1.5rem' }}>
          {['login', 'register'].map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null) }} style={{
              flex: 1, padding: '0.6rem', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: '0.9rem', fontWeight: tab === t ? '700' : '500',
              color: tab === t ? TEXT_DARKEST : TEXT_LIGHT,
              borderBottom: `2px solid ${tab === t ? TEXT_DARKEST : 'transparent'}`,
              marginBottom: '-2px', transition: 'all 0.15s',
            }}>
              {t === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {tab === 'register' && (
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
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
              Email
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              onFocus={() => setFocused('email')} onBlur={() => setFocused(null)}
              placeholder="you@example.com" required style={inputStyle(focused === 'email')}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
              Password
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              onFocus={() => setFocused('pass')} onBlur={() => setFocused(null)}
              placeholder="••••••••" required style={inputStyle(focused === 'pass')}
            />
          </div>

          {error && (
            <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: ERROR_BG, borderRadius: '8px', fontSize: '0.83rem', color: ERROR }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '0.75rem',
            background: loading ? BORDER_LIGHT : PRIMARY,
            color: loading ? TEXT_VERY_LIGHT : TEXT,
            border: 'none', borderRadius: '8px',
            cursor: loading ? 'default' : 'pointer',
            fontWeight: '700', fontSize: '0.95rem',
            transition: 'background 0.15s',
          }}>
            {loading ? 'Please wait…' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
