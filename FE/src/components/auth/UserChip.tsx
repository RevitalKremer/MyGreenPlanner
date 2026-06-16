import React, { useState } from 'react'
import { PRIMARY, TEXT, TEXT_DARK, TEXT_MUTED, WHITE_75 } from '../../styles/colors'
import UserProfileModal from './UserProfileModal'
import AdminPanel from '../admin/AdminPanel'
import { useLang } from '../../i18n/LangContext'

const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const PersonIcon = ({ size = 22, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

/**
 * Shared user chip for all pages — collapses to just an avatar circle.
 * dark=true  → app header (dark bg, light text)
 * dark=false → welcome screen (light bg, dark text)
 *
 * Click target:
 *   non-admin → MyAccount modal (credits + profile + sign-out live there)
 *   admin     → UserProfileModal (profile + sign-out live there)
 */
export default function UserChip({ user, onSignIn, onSignOut, onUpdateProfile, onOpenAccount, dark = false }) {
  const { t } = useLang()
  const [showProfile, setShowProfile] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)

  const isCreditsUser = !!(user && user.role !== 'admin')
  // For non-admins, the avatar / name area becomes the single entry point
  // into "My Account" (which contains credits, ledger, profile editing).
  // For admins, credits don't apply — keep today's profile-modal click target.
  const avatarOpensAccount = isCreditsUser && !!onOpenAccount

  const col = (lightVal, darkVal) => dark ? darkVal : lightVal

  // Icon-button style — same in both contexts
  const iconBtn = (extraColor?): React.CSSProperties => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '0.3rem 0.55rem',
    color: extraColor ?? col(TEXT_DARK, WHITE_75),
  })

  const labelStyle: React.CSSProperties = {
    fontSize: '0.6rem', fontWeight: '600', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
        {user ? (
          <>
            {/* Just the avatar — name, balance pill, and sign-out moved into
                the modal that opens on click (MyAccount for non-admin,
                UserProfileModal for admin). Single icon, single entry point. */}
            <button
              onClick={() => avatarOpensAccount ? onOpenAccount() : setShowProfile(true)}
              title={user.full_name || t('user.myAccount')}
              style={{
                width: '32px', height: '32px', borderRadius: '50%',
                background: PRIMARY, color: TEXT, border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: '800', fontSize: '0.92rem', cursor: 'pointer',
                flexShrink: 0, padding: 0, margin: '0 0.3rem',
              }}
            >
              {user.full_name?.charAt(0)?.toUpperCase() ?? '?'}
            </button>

            {/* Admin gear — only for admins */}
            {user.role === 'admin' && (
              <button onClick={() => setShowAdmin(true)} style={iconBtn()} title={t('user.adminPanel')}>
                <GearIcon />
                <span style={{ ...labelStyle, color: col(TEXT_DARK, WHITE_75) }}>{t('user.adminBadge')}</span>
              </button>
            )}
          </>
        ) : (
          /* Guest — person icon + Sign In */
          <button onClick={onSignIn} style={iconBtn()}>
            <PersonIcon color={col(TEXT_MUTED, WHITE_75)} />
            <span style={{ ...labelStyle, color: col(TEXT_DARK, WHITE_75) }}>{t('auth.signIn')}</span>
          </button>
        )}
      </div>

      {showProfile && user && (
        <UserProfileModal
          user={user}
          onClose={() => setShowProfile(false)}
          onSave={onUpdateProfile}
          onSignOut={onSignOut}
        />
      )}
      {showAdmin && user?.role === 'admin' && (
        <AdminPanel onClose={() => setShowAdmin(false)} currentUserId={user.id} />
      )}
    </>
  )
}
