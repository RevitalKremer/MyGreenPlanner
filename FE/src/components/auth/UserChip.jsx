import { useState } from 'react'
import { PRIMARY, TEXT, TEXT_DARK, TEXT_MUTED, BORDER_LIGHT } from '../../styles/colors'
import UserProfileModal from './UserProfileModal'
import AdminPanel from '../admin/AdminPanel'

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
 * Shared user chip for all pages.
 * dark=true  → app header (dark bg, light text)
 * dark=false → welcome screen (light bg, dark text)
 */
export default function UserChip({ user, onSignIn, onSignOut, onUpdateProfile, dark = false }) {
  const [showProfile, setShowProfile] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)

  const col = (lightVal, darkVal) => dark ? darkVal : lightVal

  // Icon-button style — same in both contexts
  const iconBtn = (extraColor) => ({
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
    background: 'none', border: 'none', cursor: 'pointer',
    padding: '0.3rem 0.55rem',
    color: extraColor ?? col(TEXT_DARK, 'rgba(255,255,255,0.75)'),
  })

  const labelStyle = {
    fontSize: '0.6rem', fontWeight: '600', letterSpacing: '0.04em', whiteSpace: 'nowrap',
  }

  const signOutStyle = {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: '0.58rem', padding: 0, lineHeight: 1,
    textDecoration: 'underline',
    color: col('rgba(0,0,0,0.35)', 'rgba(255,255,255,0.4)'),
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.1rem' }}>
        {user ? (
          <>
            {/* Avatar + name + sign-out */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '0.3rem 0.55rem' }}>
              <button
                onClick={() => setShowProfile(true)}
                title="My Account"
                style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: PRIMARY, color: TEXT, border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: '800', fontSize: '0.82rem', cursor: 'pointer', flexShrink: 0,
                }}
              >
                {user.full_name?.charAt(0)?.toUpperCase() ?? '?'}
              </button>
              <span style={{ ...labelStyle, color: col(TEXT_DARK, 'rgba(255,255,255,0.9)'), maxWidth: '68px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.full_name?.split(' ')[0]}
              </span>
              <button onClick={onSignOut} style={signOutStyle}>Sign Out</button>
            </div>

            {/* Admin gear — only for admins */}
            {user.role === 'admin' && (
              <button onClick={() => setShowAdmin(true)} style={iconBtn()} title="Admin Panel">
                <GearIcon />
                <span style={{ ...labelStyle, color: col(TEXT_DARK, 'rgba(255,255,255,0.75)') }}>Admin</span>
              </button>
            )}
          </>
        ) : (
          /* Guest — person icon + Sign In */
          <button onClick={onSignIn} style={iconBtn()}>
            <PersonIcon color={col(TEXT_MUTED, 'rgba(255,255,255,0.75)')} />
            <span style={{ ...labelStyle, color: col(TEXT_DARK, 'rgba(255,255,255,0.75)') }}>Sign In</span>
          </button>
        )}
      </div>

      {showProfile && user && (
        <UserProfileModal
          user={user}
          onClose={() => setShowProfile(false)}
          onSave={onUpdateProfile}
        />
      )}
      {showAdmin && user?.role === 'admin' && (
        <AdminPanel onClose={() => setShowAdmin(false)} currentUserId={user.id} />
      )}
    </>
  )
}
