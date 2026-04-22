import { useState, useEffect, useRef } from 'react'
import { PRIMARY, TEXT, TEXT_DARKEST, TEXT_DARK, TEXT_SECONDARY, TEXT_MUTED, TEXT_FAINT, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_FAINTEST, BORDER_LIGHT, BORDER_FAINT } from '../styles/colors'
import AuthModal from './auth/AuthModal'
import UserChip from './auth/UserChip'
import { useLang } from '../i18n/LangContext'
import LangToggle from '../i18n/LangToggle'
import { getBackendVersion, getFrontendVersion } from '../services/projectsApi'

// Monochrome SVG icons
const IconPlus = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export default function WelcomeScreen({ onCreateProject, user, onLogin, onRegister, onLogout, onUpdateProfile, authLoading, cloudProjects, cloudProjectsLoading, totalProjectsCount, hasMoreProjects, onLoadCloudProject, onUpdateCloudProject, onDeleteCloudProject, onLoadMoreProjects, onProjectsSearch, projectsSearch, onForgotPassword, onResetPassword, appConfigReady = false }) {
  const { t } = useLang()
  const [mode, setMode] = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [location, setLocation] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [roofType, setRoofType] = useState('concrete')
  const [distanceBetweenPurlins, setDistanceBetweenPurlins] = useState('')
  const [installationOrientation, setInstallationOrientation] = useState('perpendicular')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [localSearch, setLocalSearch] = useState(projectsSearch || '')
  const searchTimerRef = useRef(null)
  const [backendVersion, setBackendVersion] = useState(null)

  const frontendVersion = getFrontendVersion()

  useEffect(() => {
    getBackendVersion().then(version => setBackendVersion(version)).catch(() => {})
  }, [])

  const canCreate = projectName.trim().length > 0 && appConfigReady

  const handleSearchChange = (e) => {
    const value = e.target.value
    setLocalSearch(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      onProjectsSearch(value.trim())
    }, 350)
  }

  const handleClearSearch = () => {
    setLocalSearch('')
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    onProjectsSearch('')
  }

  const handleCreate = () => {
    if (!canCreate) return
    const roofSpec = {
      type: roofType,
      ...(roofType === 'iskurit' || roofType === 'insulated_panel' ? {
        distanceBetweenPurlinsCm: parseFloat(distanceBetweenPurlins) || null,
        installationOrientation: installationOrientation
      } : {})
    }
    onCreateProject({ name: projectName.trim(), location: location.trim(), date, roofSpec })
  }

  const handleAuthSuccess = async (tab, email, password, fullName, phone) => {
    if (tab === 'login') {
      await onLogin(email, password)
      setShowAuth(false)
    } else {
      await onRegister(email, password, fullName, phone)
      // Don't close — AuthModal transitions to 'registered' screen internally
    }
  }

  return (
    <>
      <style>{`
        .projects-scrollable::-webkit-scrollbar {
          width: 8px;
        }
        .projects-scrollable::-webkit-scrollbar-track {
          background: #f0f0f0;
          border-radius: 4px;
        }
        .projects-scrollable::-webkit-scrollbar-thumb {
          background: #c0c0c0;
          border-radius: 4px;
        }
        .projects-scrollable::-webkit-scrollbar-thumb:hover {
          background: #a0a0a0;
        }
      `}</style>
      <div style={{
      height: '100vh',
      background: 'linear-gradient(160deg, #ebebeb 0%, #d8d8d8 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '1.5rem 2rem 1.5rem', fontFamily: 'inherit', position: 'relative',
      overflowY: 'auto'
    }}>

      {/* Top right: lang toggle + auth */}
      <div style={{ position: 'absolute', top: '1.25rem', right: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <LangToggle dark={false} />
        {!authLoading && (
          <UserChip
            user={user}
            onSignIn={() => setShowAuth(true)}
            onSignOut={onLogout}
            onUpdateProfile={onUpdateProfile}
            dark={false}
          />
        )}
      </div>

      {/* Logo + title */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/mgp-logo.svg" alt="MyGreenPlanner" style={{ height: '70px', width: 'auto', marginBottom: '0.8rem' }} />
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '2.2rem', fontWeight: '800', color: TEXT_DARKEST }}>
          {t('app.title')}
        </h1>
        <p style={{ margin: 0, fontSize: '1rem', color: TEXT_FAINT, fontWeight: '400' }}>
          {t('app.subtitle')}
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
              <div style={{ fontSize: '1.05rem', fontWeight: '700', color: TEXT_DARKEST }}>{t('welcome.newProject')}</div>
              <div style={{ fontSize: '0.8rem', color: TEXT_LIGHT, marginTop: '2px' }}>{t('welcome.newProjectDesc')}</div>
            </div>
          </div>

          {mode === 'new' && (
            <div style={{ padding: '1.25rem 1.75rem 1.5rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                  {t('welcome.projectName')} <span style={{ color: '#e53935' }}>{t('welcome.required')}</span>
                </label>
                <input
                  autoFocus
                  type="text"
                  value={projectName}
                  onChange={e => setProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder={t('welcome.projectNamePlaceholder')}
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: `1.5px solid ${projectName.trim() ? TEXT_DARK : BORDER_LIGHT}`,
                    borderRadius: '8px', fontSize: '0.92rem', outline: 'none'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                  {t('welcome.location')}
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder={t('welcome.locationPlaceholder')}
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.92rem'
                  }}
                />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                  {t('welcome.date')}
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
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                  {t('welcome.roofType')}
                </label>
                <select
                  value={roofType}
                  onChange={e => setRoofType(e.target.value)}
                  style={{
                    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                    border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.92rem',
                    background: 'white', cursor: 'pointer'
                  }}
                >
                  <option value="concrete">{t('roofSpec.type.concrete')}</option>
                  <option value="tiles">{t('roofSpec.type.tiles')}</option>
                  <option value="iskurit">{t('roofSpec.type.iskurit')}</option>
                  <option value="insulated_panel">{t('roofSpec.type.insulatedPanel')}</option>
                  <option value="mixed">{t('roofSpec.type.mixed')}</option>
                </select>
              </div>
              {/* Global purlin params are hidden for 'mixed' — they'll be set per-area in step 2. */}
              {(roofType === 'iskurit' || roofType === 'insulated_panel') && (
                <>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                      {t('roofSpec.distanceBetweenPurlins')}
                    </label>
                    <input
                      type="number"
                      value={distanceBetweenPurlins}
                      onChange={e => setDistanceBetweenPurlins(e.target.value)}
                      placeholder={t('roofSpec.distancePlaceholder')}
                      style={{
                        width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                        border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.92rem'
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: '1.25rem' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY, marginBottom: '0.4rem' }}>
                      {t('roofSpec.installationOrientation')}
                    </label>
                    <select
                      value={installationOrientation}
                      onChange={e => setInstallationOrientation(e.target.value)}
                      style={{
                        width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
                        border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.92rem',
                        background: 'white', cursor: 'pointer'
                      }}
                    >
                      <option value="perpendicular">{t('roofSpec.orientation.perpendicular')}</option>
                      <option value="parallel">{t('roofSpec.orientation.parallel')}</option>
                    </select>
                  </div>
                </>
              )}
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
                {t('welcome.startPlanning')}
              </button>
              {!appConfigReady && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginTop: '0.5rem', fontSize: '0.75rem', color: TEXT_LIGHT }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                  </svg>
                  {t('welcome.loadingSettings')}
                  <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* My Projects / All Projects — visible to logged-in users */}
      {user && (
        <div style={{ width: '100%', maxWidth: '780px', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {user.role === 'admin' ? t('welcome.allProjects') : t('welcome.savedProjects')}
            </div>
            {cloudProjects.length > 0 && (
              <div style={{ fontSize: '0.75rem', color: TEXT_MUTED }}>
                {t('welcome.showingCount', { shown: cloudProjects.length, total: totalProjectsCount })}
              </div>
            )}
          </div>

          {/* Search bar */}
          {(cloudProjects.length > 0 || localSearch) && (
            <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                value={localSearch}
                onChange={handleSearchChange}
                placeholder={t('welcome.searchPlaceholder')}
                style={{
                  flex: 1,
                  padding: '0.5rem 0.75rem',
                  border: `1.5px solid ${BORDER_LIGHT}`,
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  outline: 'none'
                }}
              />
              {localSearch && (
                <button
                  onClick={handleClearSearch}
                  style={{
                    padding: '0.5rem 0.75rem',
                    background: 'white',
                    border: `1.5px solid ${BORDER_LIGHT}`,
                    borderRadius: '8px',
                    color: TEXT_MUTED,
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                >
                  ✕ {t('welcome.clearSearch')}
                </button>
              )}
            </div>
          )}

          {cloudProjectsLoading && cloudProjects.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: TEXT_LIGHT, padding: '0.75rem 0' }}>{t('welcome.loading')}</div>
          ) : cloudProjects.length === 0 && localSearch ? (
            <div style={{ fontSize: '0.82rem', color: TEXT_LIGHT, padding: '0.75rem 0' }}>{t('welcome.noMatchingProjects')}</div>
          ) : cloudProjects.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: TEXT_LIGHT, padding: '0.75rem 0' }}>{t('welcome.noProjects')}</div>
          ) : (
            <div
              className="projects-scrollable"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                maxHeight: '300px',
                overflowY: 'auto',
                paddingRight: '0.25rem'
              }}>
              {cloudProjects.map(p => {
                const isEditing = editingId === p.id
                return (
                  <div key={p.id} style={{
                    background: 'white', borderRadius: '10px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
                    border: `1.5px solid ${isEditing ? TEXT_DARK : BORDER_LIGHT}`,
                    padding: '0.75rem 1rem',
                    display: 'flex', alignItems: 'center', gap: '1rem',
                  }}>
                    {isEditing ? (
                      // Edit mode
                      <>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <input
                            type="text"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            placeholder={t('welcome.projectName')}
                            style={{
                              width: '100%', padding: '0.4rem 0.6rem', boxSizing: 'border-box',
                              border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '6px',
                              fontSize: '0.85rem', outline: 'none'
                            }}
                          />
                          <input
                            type="text"
                            value={editLocation}
                            onChange={e => setEditLocation(e.target.value)}
                            placeholder={t('welcome.location')}
                            style={{
                              width: '100%', padding: '0.4rem 0.6rem', boxSizing: 'border-box',
                              border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '6px',
                              fontSize: '0.85rem', outline: 'none'
                            }}
                          />
                        </div>
                        <button
                          onClick={() => {
                            if (editName.trim()) {
                              onUpdateCloudProject(p.id, editName.trim(), editLocation.trim())
                              setEditingId(null)
                            }
                          }}
                          disabled={!editName.trim()}
                          style={{
                            padding: '0.4rem 0.9rem',
                            background: editName.trim() ? PRIMARY : BORDER_LIGHT,
                            color: editName.trim() ? 'white' : TEXT_VERY_LIGHT,
                            border: 'none', borderRadius: '7px',
                            cursor: editName.trim() ? 'pointer' : 'default',
                            fontSize: '0.8rem', fontWeight: '700', whiteSpace: 'nowrap',
                          }}
                        >
                          {t('welcome.save')}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: '0.4rem 0.9rem', background: 'white',
                            color: TEXT_DARK, border: `1.5px solid ${BORDER_LIGHT}`,
                            borderRadius: '7px', cursor: 'pointer',
                            fontSize: '0.8rem', fontWeight: '700', whiteSpace: 'nowrap',
                          }}
                        >
                          {t('welcome.cancel')}
                        </button>
                      </>
                    ) : (
                      // Display mode
                      <>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.9rem', fontWeight: '700', color: TEXT_DARKEST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: TEXT_LIGHT, marginTop: '2px' }}>
                            {p.location ? `${p.location} · ` : ''}
                            {new Date(p.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            {user.role === 'admin' && p.owner_email && ` · ${p.owner_email}`}
                          </div>
                        </div>
                        <button
                          onClick={() => onLoadCloudProject(p.id)}
                          disabled={!appConfigReady}
                          style={{
                            padding: '0.4rem 0.9rem', background: appConfigReady ? TEXT_DARK : BORDER_LIGHT, color: appConfigReady ? 'white' : TEXT_VERY_LIGHT,
                            border: 'none', borderRadius: '7px', cursor: appConfigReady ? 'pointer' : 'default',
                            fontSize: '0.8rem', fontWeight: '700', whiteSpace: 'nowrap',
                          }}
                        >
                          {t('welcome.open')}
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(p.id)
                            setEditName(p.name)
                            setEditLocation(p.location || '')
                          }}
                          title={t('welcome.editProject')}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: TEXT_VERY_LIGHT, padding: '0.3rem', display: 'flex', alignItems: 'center',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => onDeleteCloudProject(p.id)}
                          title={t('welcome.deleteProject')}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: TEXT_VERY_LIGHT, padding: '0.3rem', display: 'flex', alignItems: 'center',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
              {hasMoreProjects && (
                <button
                  onClick={onLoadMoreProjects}
                  disabled={cloudProjectsLoading}
                  style={{
                    padding: '0.5rem 0.9rem',
                    marginTop: '0.25rem',
                    background: PRIMARY,
                    color: TEXT,
                    border: 'none',
                    borderRadius: '8px',
                    cursor: cloudProjectsLoading ? 'default' : 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: '700',
                    alignSelf: 'center',
                    opacity: cloudProjectsLoading ? 0.6 : 1,
                  }}
                >
                  {cloudProjectsLoading ? t('welcome.loading') : t('welcome.loadMore')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sadot Energy branding */}
      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: '600', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {t('welcome.poweredBy')}
        </span>
        <img src="/sadot-logo.png" alt="Sadot Energy" style={{ height: '32px', width: 'auto' }} />
      </div>

      <p style={{ marginTop: '1rem', fontSize: '0.72rem', color: TEXT_FAINTEST }}>
        {t('welcome.copyright')} {new Date().getFullYear()}
      </p>

      {/* Version information */}
      <div style={{ marginTop: '0.5rem', marginBottom: '1rem', fontSize: '0.62rem', color: TEXT_FAINTEST, display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <span>App: v{frontendVersion}</span>
        <span>•</span>
        <span>Srv: {backendVersion ? `v${backendVersion}` : '...'}</span>
      </div>

      {showAuth && (
        <AuthModal
          onClose={() => setShowAuth(false)}
          onSuccess={handleAuthSuccess}
          onForgotPassword={onForgotPassword}
          onResetPassword={onResetPassword}
        />
      )}
    </div>
    </>
  )
}
