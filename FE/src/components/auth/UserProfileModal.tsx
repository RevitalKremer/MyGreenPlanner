import React, { useState } from 'react'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, ERROR, ERROR_BG, SUCCESS, SUCCESS_BG,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

const inputStyle = (focused): React.CSSProperties => ({
  width: '100%', padding: '0.65rem 0.8rem', boxSizing: 'border-box',
  border: `1.5px solid ${focused ? TEXT_DARKEST : BORDER_LIGHT}`,
  borderRadius: '8px', fontSize: '0.92rem', outline: 'none',
  transition: 'border-color 0.15s',
})

export default function UserProfileModal({ user, onClose, onSave }) {
  const { t } = useLang()
  const [fullName, setFullName] = useState(user.full_name ?? '')
  const [phone, setPhone] = useState(user.phone_number ?? '')
  const [focused, setFocused] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!fullName.trim()) return
    setError(null)
    setSaved(false)
    setLoading(true)
    try {
      await onSave({ full_name: fullName.trim(), phone_number: phone.trim() || null })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
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
        width: '100%', maxWidth: '420px', padding: '2rem',
        position: 'relative',
      }} onClick={e => e.stopPropagation()}>

        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: '1rem', right: '1rem',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '1.3rem', color: TEXT_LIGHT, lineHeight: 1,
        }}>×</button>

        {/* Avatar + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.75rem' }}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: PRIMARY, color: TEXT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: '800', fontSize: '1.3rem', flexShrink: 0,
          }}>
            {user.full_name?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: '700', color: TEXT_DARKEST }}>{t('profile.title')}</div>
            <div style={{ fontSize: '0.8rem', color: TEXT_LIGHT, marginTop: '2px' }}>{user.email}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Email — read only */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
              {t('profile.email')}
            </label>
            <input
              type="email" value={user.email} disabled
              style={{ ...inputStyle(false), background: BORDER_FAINT, color: TEXT_LIGHT, cursor: 'not-allowed' }}
            />
            <div style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, marginTop: '4px' }}>
              {t('profile.emailNote')}
            </div>
          </div>

          {/* Full name */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
              {t('profile.fullName')} <span style={{ color: ERROR }}>{t('profile.required')}</span>
            </label>
            <input
              type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              onFocus={() => setFocused('name')} onBlur={() => setFocused(null)}
              placeholder={t('profile.fullNamePlaceholder')} required
              style={inputStyle(focused === 'name')}
            />
          </div>

          {/* Phone */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
              {t('profile.phone')}
            </label>
            <input
              type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              onFocus={() => setFocused('phone')} onBlur={() => setFocused(null)}
              placeholder={t('profile.phonePlaceholder')}
              style={inputStyle(focused === 'phone')}
            />
          </div>

          {error && (
            <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: ERROR_BG, borderRadius: '8px', fontSize: '0.83rem', color: ERROR }}>
              {error}
            </div>
          )}
          {saved && (
            <div style={{ marginBottom: '1rem', padding: '0.6rem 0.8rem', background: SUCCESS_BG, borderRadius: '8px', fontSize: '0.83rem', color: SUCCESS }}>
              {t('profile.profileUpdated')}
            </div>
          )}

          <button type="submit" disabled={loading || !fullName.trim()} style={{
            width: '100%', padding: '0.75rem',
            background: loading || !fullName.trim() ? BORDER_LIGHT : PRIMARY,
            color: loading || !fullName.trim() ? TEXT_VERY_LIGHT : TEXT,
            border: 'none', borderRadius: '8px',
            cursor: loading || !fullName.trim() ? 'default' : 'pointer',
            fontWeight: '700', fontSize: '0.95rem',
            transition: 'background 0.15s',
          }}>
            {loading ? t('profile.saving') : t('profile.saveChanges')}
          </button>
        </form>
      </div>
    </div>
  )
}
