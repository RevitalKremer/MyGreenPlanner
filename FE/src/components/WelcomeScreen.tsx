import { useState, useEffect, useRef } from 'react'
import { PRIMARY, PRIMARY_DARK, TEXT, TEXT_DARK, TEXT_MUTED, TEXT_FAINT, TEXT_VERY_LIGHT, BORDER_LIGHT, BORDER_FAINT, DANGER } from '../styles/colors'
import AuthModal from './auth/AuthModal'
import UserChip from './auth/UserChip'
import ProjectForm from './ProjectForm'
import ReassignOwnerModal from './admin/ReassignOwnerModal'
import { useLang } from '../i18n/LangContext'
import LangToggle from '../i18n/LangToggle'
import { getBackendVersion, getFrontendVersion } from '../services/projectsApi'

// Maps the BE roof type discriminator to its i18n label key.
const ROOF_TYPE_I18N: Record<string, string> = {
  concrete: 'roofSpec.type.concrete',
  tiles: 'roofSpec.type.tiles',
  flat_installation: 'roofSpec.type.flatInstallation',
  iskurit: 'roofSpec.type.iskurit',
  insulated_panel: 'roofSpec.type.insulatedPanel',
  mixed: 'roofSpec.type.mixed',
}

// Monochrome SVG icons
const IconPlus = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

export default function WelcomeScreen({ onCreateProject, user, onLogin, onRegister, onLogout, onUpdateProfile, onOpenAccount, onAdminClose = null, authLoading, cloudProjects, cloudProjectsLoading, totalProjectsCount, hasMoreProjects, onLoadCloudProject, onUpdateCloudProject, onDeleteCloudProject, onLoadMoreProjects, onProjectsSearch, projectsSearch, onForgotPassword, onResetPassword, appConfigReady = false, resetToken = null, onClearResetToken, openLoginOnMount = false, onClearOpenLogin, trialGrantCredits = 0 }) {
  const { t } = useLang()
  const [mode, setMode] = useState(null)
  const [showAuth, setShowAuth] = useState(!!resetToken || !!openLoginOnMount)
  // One-shot: user clicked "New Project" while logged out → after a successful
  // login, automatically open the new-project form so they don't have to click
  // the card a second time.
  const [openFormAfterLogin, setOpenFormAfterLogin] = useState(false)

  // When a reset token arrives via URL (after initial mount), open the auth
  // modal in reset mode.
  useEffect(() => { if (resetToken) setShowAuth(true) }, [resetToken])

  // One-shot signal from App after logout — open login modal, then clear the
  // flag so a user who dismisses it isn't re-prompted on re-render.
  useEffect(() => {
    if (openLoginOnMount) {
      setShowAuth(true)
      onClearOpenLogin?.()
    }
  }, [openLoginOnMount, onClearOpenLogin])
  const [projectName, setProjectName] = useState('')
  // Defaults to the logged-in user's full name; admins may override per-project
  // when generating proposals for someone else. Re-prefilled when the user
  // object arrives async, but only while the field is still untouched.
  const [clientName, setClientName] = useState(user?.full_name ?? '')
  const clientNameTouchedRef = useRef(false)
  useEffect(() => {
    if (!clientNameTouchedRef.current && user?.full_name) {
      setClientName(user.full_name)
    }
  }, [user?.full_name])
  const [location, setLocation] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [roofType, setRoofType] = useState('mixed')
  const [distanceBetweenPurlins, setDistanceBetweenPurlins] = useState('')
  const [installationOrientation, setInstallationOrientation] = useState('perpendicular')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editClientName, setEditClientName] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [localSearch, setLocalSearch] = useState(projectsSearch || '')
  const searchTimerRef = useRef(null)
  const [backendVersion, setBackendVersion] = useState(null)
  // Admin "reassign owner": the project being reassigned, plus local overrides
  // ({ [id]: { owner_id, owner_email } }) so the row reflects the new owner
  // without a full reload.
  const [reassignProject, setReassignProject] = useState(null)
  const [ownerOverrides, setOwnerOverrides] = useState({})

  const frontendVersion = getFrontendVersion()

  useEffect(() => {
    getBackendVersion().then(version => setBackendVersion(version)).catch(() => {})
  }, [])

  const canCreate = projectName.trim().length > 0 && clientName.trim().length > 0 && appConfigReady

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
    onCreateProject({ name: projectName.trim(), client_name: clientName.trim(), location: location.trim(), date, roofSpec })
  }

  const handleAuthSuccess = async (tab, email, password, fullName, phone, company) => {
    if (tab === 'login') {
      await onLogin(email, password)
      setShowAuth(false)
      if (openFormAfterLogin) {
        setMode('new')
        setOpenFormAfterLogin(false)
      }
    } else {
      await onRegister(email, password, fullName, phone, company)
      // Don't close — AuthModal transitions to 'registered' screen internally.
      // openFormAfterLogin stays set so a follow-up login (after email verify)
      // still opens the form.
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
            onOpenAccount={onOpenAccount}
            onAdminClose={onAdminClose}
            dark={false}
          />
        )}
      </div>

      {/* Logo + title */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem', marginTop: '1rem' }}>
        <img src="/mgp-logo.svg" alt="MyGreenPlanner" style={{ height: '70px', width: 'auto', marginBottom: '0.8rem' }} />
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '2.2rem', fontWeight: '800', color: TEXT_FAINT }}>
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
            onClick={() => {
              if (!user) {
                setOpenFormAfterLogin(true)
                setShowAuth(true)
                return
              }
              setMode(mode === 'new' ? null : 'new')
            }}
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
              <div style={{ fontSize: '1.05rem', fontWeight: '700', color: TEXT_FAINT }}>{t('welcome.newProject')}</div>
              <div style={{ fontSize: '0.8rem', color: TEXT_FAINT, marginTop: '2px' }}>{t('welcome.newProjectDesc')}</div>
              {/* Signup CTA — shown only to logged-out users, when admin has
                  configured a non-zero trial grant. */}
              {!user && trialGrantCredits > 0 && (
                <div style={{ fontSize: '0.74rem', color: PRIMARY_DARK, marginTop: '4px', fontWeight: 700 }}>
                  {t('auth.register.creditsCta', { credits: trialGrantCredits })}
                </div>
              )}
            </div>
          </div>

          {mode === 'new' && (
            <ProjectForm
              projectName={projectName} setProjectName={setProjectName}
              clientName={clientName} setClientName={setClientName}
              onClientNameInteract={() => { clientNameTouchedRef.current = true }}
              location={location} setLocation={setLocation}
              date={date} setDate={setDate}
              roofType={roofType} setRoofType={setRoofType}
              distanceBetweenPurlins={distanceBetweenPurlins} setDistanceBetweenPurlins={setDistanceBetweenPurlins}
              installationOrientation={installationOrientation} setInstallationOrientation={setInstallationOrientation}
              autoFocus
              onSubmit={handleCreate}
              canSubmit={canCreate}
              appConfigReady={appConfigReady}
            />
          )}
        </div>

      </div>

      {/* My Projects / All Projects — visible to logged-in users */}
      {user && (
        <div style={{ width: '100%', maxWidth: '780px', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: '700', color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {user.role === 'admin' ? t('welcome.allProjects') : t('welcome.savedProjects')}
            </div>
            {cloudProjects.length > 0 && (
              <div style={{ fontSize: '0.75rem', color: TEXT_FAINT }}>
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
            <div style={{ fontSize: '0.82rem', color: TEXT_FAINT, padding: '0.75rem 0' }}>{t('welcome.loading')}</div>
          ) : cloudProjects.length === 0 && localSearch ? (
            <div style={{ fontSize: '0.82rem', color: TEXT_FAINT, padding: '0.75rem 0' }}>{t('welcome.noMatchingProjects')}</div>
          ) : cloudProjects.length === 0 ? (
            <div style={{ fontSize: '0.82rem', color: TEXT_FAINT, padding: '0.75rem 0' }}>{t('welcome.noProjects')}</div>
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
                // Apply any local reassign override so the row reflects a just-
                // changed owner without a reload.
                const ov = ownerOverrides[p.id]
                const effOwnerId = ov?.owner_id ?? p.owner_id
                const effOwnerEmail = ov?.owner_email ?? p.owner_email
                // Own vs company-shared (owned by a colleague). Emphasize own
                // projects with a PRIMARY left accent; shared ones stay muted
                // and show the owner's email (set by the BE only for shared).
                const isOwn = !!user && effOwnerId === user.id
                return (
                  <div key={p.id} style={{
                    background: 'white', borderRadius: '10px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
                    border: `1.5px solid ${isEditing ? TEXT_DARK : BORDER_LIGHT}`,
                    borderLeft: isEditing ? undefined : `4px solid ${isOwn ? PRIMARY : BORDER_FAINT}`,
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
                            value={editClientName}
                            onChange={e => setEditClientName(e.target.value)}
                            placeholder={t('welcome.clientName')}
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
                            if (editName.trim() && editClientName.trim()) {
                              onUpdateCloudProject(p.id, editName.trim(), editClientName.trim(), editLocation.trim())
                              setEditingId(null)
                            }
                          }}
                          disabled={!editName.trim() || !editClientName.trim()}
                          style={{
                            padding: '0.4rem 0.9rem',
                            background: (editName.trim() && editClientName.trim()) ? PRIMARY : BORDER_LIGHT,
                            color: (editName.trim() && editClientName.trim()) ? 'white' : TEXT_VERY_LIGHT,
                            border: 'none', borderRadius: '7px',
                            cursor: (editName.trim() && editClientName.trim()) ? 'pointer' : 'default',
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
                          <div style={{ fontSize: '0.9rem', fontWeight: isOwn ? '800' : '600', color: isOwn ? TEXT_DARK : TEXT_FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                            {!isOwn && (
                              <span style={{ flexShrink: 0, fontSize: '0.62rem', fontWeight: '700', color: TEXT_MUTED, background: BORDER_FAINT, borderRadius: '10px', padding: '0.05rem 0.45rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {t('welcome.sharedTag')}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: TEXT_FAINT, marginTop: '2px' }}>
                            {p.client_name ? `${p.client_name} · ` : ''}
                            {p.location ? `${p.location} · ` : ''}
                            {p.roof_spec?.type && ROOF_TYPE_I18N[p.roof_spec.type]
                              ? `${t(ROOF_TYPE_I18N[p.roof_spec.type])} · `
                              : ''}
                            {new Date(p.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            {/* owner_email is sent by the BE only for admins and for
                                company-shared projects (owned by a colleague) — so its
                                mere presence means "show who owns this". */}
                            {effOwnerEmail && ` · ${effOwnerEmail}`}
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
                            setEditClientName(p.client_name || '')
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
                        {user?.role === 'admin' && (
                          <button
                            onClick={() => setReassignProject({ id: p.id, name: p.name })}
                            title={t('welcome.reassignOwner')}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: TEXT_VERY_LIGHT, padding: '0.3rem', display: 'flex', alignItems: 'center',
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/>
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteCloudProject(p.id)}
                          title={t('welcome.deleteProject')}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: DANGER, padding: '0.3rem', display: 'flex', alignItems: 'center',
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
        <span style={{ fontSize: '0.65rem', fontWeight: '600', color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {t('welcome.poweredBy')}
        </span>
        <img src="/sadot-logo.png" alt="Sadot Energy" style={{ height: '32px', width: 'auto' }} />
      </div>

      <p style={{ marginTop: '1rem', fontSize: '0.72rem', color: TEXT_FAINT }}>
        {t('welcome.copyright')} {new Date().getFullYear()}
      </p>

      {/* Version information */}
      <div style={{ marginTop: '0.5rem', marginBottom: '1rem', fontSize: '0.62rem', color: TEXT_FAINT, display: 'flex', gap: '1rem', justifyContent: 'center' }}>
        <span>App: v{frontendVersion}</span>
        <span>•</span>
        <span>Srv: {backendVersion ? `v${backendVersion}` : '...'}</span>
      </div>

      {showAuth && (
        <AuthModal
          onClose={() => { setShowAuth(false); setOpenFormAfterLogin(false); onClearResetToken?.() }}
          onSuccess={handleAuthSuccess}
          onForgotPassword={onForgotPassword}
          onResetPassword={onResetPassword}
          resetToken={resetToken}
          trialGrantCredits={trialGrantCredits}
        />
      )}

      {reassignProject && (
        <ReassignOwnerModal
          project={reassignProject}
          onClose={() => setReassignProject(null)}
          onReassigned={(id, ownerId, ownerEmail) => {
            setOwnerOverrides(o => ({ ...o, [id]: { owner_id: ownerId, owner_email: ownerEmail } }))
            setReassignProject(null)
          }}
        />
      )}
    </div>
    </>
  )
}
