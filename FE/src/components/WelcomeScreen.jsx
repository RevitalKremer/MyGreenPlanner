import { useState, useRef } from 'react'
import { PRIMARY, TEXT, TEXT_DARKEST, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_FAINT, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_FAINTEST, BORDER_LIGHT, BORDER_FAINT } from '../styles/colors'
import AuthModal from './auth/AuthModal'
import UserChip from './auth/UserChip'

// Monochrome SVG icons
const IconPlus = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)
const IconFolder = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

export default function WelcomeScreen({ onCreateProject, onImportProject, user, onLogin, onRegister, onLogout, onUpdateProfile, authLoading }) {
  const [mode, setMode] = useState(null) // 'new' | 'import'
  const [showAuth, setShowAuth] = useState(false)
  const [projectMode, setProjectMode] = useState('scratch') // 'scratch' | 'plan'
  const [projectName, setProjectName] = useState('')
  const [location, setLocation] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [importError, setImportError] = useState(null)
  const fileInputRef = useRef(null)

  const canCreate = projectName.trim().length > 0

  const handleCreate = () => {
    if (!canCreate) return
    onCreateProject({ name: projectName.trim(), location: location.trim(), date, mode: projectMode })
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.version) throw new Error('Invalid project file')
        onImportProject(data)
      } catch {
        setImportError('Could not read project file. Make sure it is a valid .mgp file.')
      }
    }
    reader.readAsText(file)
  }

  const handleAuthSuccess = async (tab, email, password, fullName, phone) => {
    if (tab === 'login') await onLogin(email, password)
    else await onRegister(email, password, fullName, phone)
    setShowAuth(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #ebebeb 0%, #d8d8d8 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', fontFamily: 'inherit', position: 'relative'
    }}>

      {/* Auth area — top right */}
      {!authLoading && (
        <div style={{ position: 'absolute', top: '1.25rem', right: '1.5rem' }}>
          <UserChip
            user={user}
            onSignIn={() => setShowAuth(true)}
            onSignOut={onLogout}
            onUpdateProfile={onUpdateProfile}
            dark={false}
          />
        </div>
      )}

      {/* Logo + title */}
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <img src="/mgp-logo.svg" alt="MyGreenPlanner" style={{ height: '80px', width: 'auto', marginBottom: '1.1rem' }} />
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '2.2rem', fontWeight: '800', color: TEXT_DARKEST }}>
          MyGreenPlanner
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: TEXT_FAINT, fontWeight: '400' }}>
          Solar PV Roof Planning System
        </p>
      </div>

      {/* Cards */}
      <div style={{
        display: 'flex', gap: '1.5rem', alignItems: 'flex-start',
        flexWrap: 'wrap', justifyContent: 'center',
        width: '100%', maxWidth: '780px'
      }}>

        {/* New Project card */}
        <div style={{
          flex: '1 1 320px', maxWidth: '360px',
          background: 'white', borderRadius: '16px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.09)',
          border: `2px solid ${mode === 'new' ? TEXT_DARK : BORDER_LIGHT}`,
          overflow: 'hidden', transition: 'border-color 0.15s'
        }}>
          <div
            onClick={() => setMode(mode === 'new' ? null : 'new')}
            style={{
              padding: '1.5rem 1.75rem', cursor: 'pointer',
              background: mode === 'new' ? '#f6f6f6' : 'white',
              display: 'flex', alignItems: 'center', gap: '1rem',
              borderBottom: mode === 'new' ? `1px solid ${BORDER_FAINT}` : 'none',
              transition: 'background 0.15s'
            }}
          >
            <div style={{
              width: '46px', height: '46px', borderRadius: '12px',
              background: BORDER_FAINT, color: TEXT_DARK,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }}>
              <IconPlus />
            </div>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: '700', color: TEXT_DARKEST }}>New Project</div>
              <div style={{ fontSize: '0.8rem', color: TEXT_LIGHT, marginTop: '2px' }}>Start a new solar planning session</div>
            </div>
          </div>

          {mode === 'new' && (
            <div style={{ padding: '1.25rem 1.75rem 1.5rem' }}>
              {/* Project mode selector */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.5rem' }}>
                  Project Type
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {[
                    { value: 'scratch', label: 'From Scratch', desc: 'Map roof → design layout' },
                    { value: 'plan', label: 'I Have a Plan', desc: 'Import & detect existing panels' }
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setProjectMode(opt.value)}
                      style={{
                        flex: 1, padding: '0.6rem 0.5rem', border: '1.5px solid',
                        borderColor: projectMode === opt.value ? TEXT_DARK : BORDER_LIGHT,
                        borderRadius: '8px', cursor: 'pointer', textAlign: 'left',
                        background: projectMode === opt.value ? '#f6f6f6' : 'white',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ fontSize: '0.8rem', fontWeight: '700', color: projectMode === opt.value ? TEXT_DARKEST : TEXT_SECONDARY }}>
                        {opt.label}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: TEXT_LIGHT, marginTop: '2px' }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                  Project Name <span style={{ color: '#e53935' }}>*</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Smith Residence"
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: `1.5px solid ${projectName.trim() ? TEXT_DARK : BORDER_LIGHT}`,
                    borderRadius: '8px', fontSize: '0.92rem', outline: 'none'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                  Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Tel Aviv, Israel"
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.92rem'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.92rem'
                  }}
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={!canCreate}
                style={{
                  width: '100%', padding: '0.75rem',
                  background: canCreate ? PRIMARY : BORDER_LIGHT,
                  color: canCreate ? TEXT : TEXT_VERY_LIGHT,
                  border: 'none', borderRadius: '8px',
                  cursor: canCreate ? 'pointer' : 'default',
                  fontWeight: '700', fontSize: '0.95rem',
                  transition: 'background 0.15s'
                }}
              >
                Start Planning →
              </button>
            </div>
          )}
        </div>

        {/* Import Project card */}
        <div style={{
          flex: '1 1 320px', maxWidth: '360px',
          background: 'white', borderRadius: '16px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.09)',
          border: `2px solid ${mode === 'import' ? TEXT_DARK : BORDER_LIGHT}`,
          overflow: 'hidden', transition: 'border-color 0.15s'
        }}>
          <div
            onClick={() => { setMode(mode === 'import' ? null : 'import'); setImportError(null) }}
            style={{
              padding: '1.5rem 1.75rem', cursor: 'pointer',
              background: mode === 'import' ? '#f6f6f6' : 'white',
              display: 'flex', alignItems: 'center', gap: '1rem',
              borderBottom: mode === 'import' ? `1px solid ${BORDER_FAINT}` : 'none',
              transition: 'background 0.15s'
            }}
          >
            <div style={{
              width: '46px', height: '46px', borderRadius: '12px',
              background: BORDER_FAINT, color: TEXT_DARK,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }}>
              <IconFolder />
            </div>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: '700', color: TEXT_DARKEST }}>Import Project</div>
              <div style={{ fontSize: '0.8rem', color: TEXT_LIGHT, marginTop: '2px' }}>Resume from a saved .mgp file</div>
            </div>
          </div>

          {mode === 'import' && (
            <div style={{ padding: '1.25rem 1.75rem 1.5rem' }}>
              <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: TEXT_MUTED, lineHeight: 1.5 }}>
                Select a <strong>.mgp</strong> project file exported from a previous session.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%', padding: '0.75rem',
                  background: TEXT_DARK, color: 'white',
                  border: 'none', borderRadius: '8px',
                  cursor: 'pointer', fontWeight: '700', fontSize: '0.95rem'
                }}
              >
                Select File…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".mgp,.json"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              {importError && (
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#e53935', background: '#FFEBEE', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                  {importError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sadot Energy branding */}
      <div style={{ marginTop: '3.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: '600', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Powered by
        </span>
        <img src="/sadot-logo.png" alt="Sadot Energy" style={{ height: '32px', width: 'auto' }} />
      </div>

      <p style={{ marginTop: '2rem', fontSize: '0.72rem', color: TEXT_FAINTEST }}>
        MyGreenPlanner © {new Date().getFullYear()}
      </p>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={handleAuthSuccess}
        />
      )}
    </div>
  )
}
