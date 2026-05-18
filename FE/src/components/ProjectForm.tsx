import React from 'react'
import { PRIMARY, TEXT, TEXT_DARK, TEXT_FAINT, TEXT_VERY_LIGHT, BORDER_LIGHT } from '../styles/colors'
import { useLang } from '../i18n/LangContext'

// Shared field-row + create-button layout used by WelcomeScreen (new-project
// flow) and ProjectInfoModal (read-only project details). Caller owns all
// state; pass `readOnly` to render disabled fields with no submit button.

interface ProjectFormProps {
  projectName: string
  clientName: string
  location: string
  date: string
  roofType: string
  distanceBetweenPurlins: string
  installationOrientation: string
  setProjectName?: (v: string) => void
  setClientName?: (v: string) => void
  setLocation?: (v: string) => void
  setDate?: (v: string) => void
  setRoofType?: (v: string) => void
  setDistanceBetweenPurlins?: (v: string) => void
  setInstallationOrientation?: (v: string) => void
  readOnly?: boolean
  autoFocus?: boolean
  onClientNameInteract?: () => void
  onSubmit?: () => void
  canSubmit?: boolean
  submitLabel?: string
  appConfigReady?: boolean
}

export default function ProjectForm({
  projectName, clientName, location, date, roofType,
  distanceBetweenPurlins, installationOrientation,
  setProjectName, setClientName, setLocation, setDate, setRoofType,
  setDistanceBetweenPurlins, setInstallationOrientation,
  readOnly = false, autoFocus = false, onClientNameInteract,
  onSubmit, canSubmit = false, submitLabel,
  appConfigReady = true,
}: ProjectFormProps) {
  const { t } = useLang()

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '0.6rem 0.75rem', boxSizing: 'border-box',
    borderRadius: '8px', fontSize: '0.92rem',
  }
  const onEnterSubmit = (e: React.KeyboardEvent) => {
    if (!readOnly && e.key === 'Enter' && onSubmit) onSubmit()
  }

  return (
    <div style={{ padding: '1.25rem 1.75rem 1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: TEXT_FAINT, marginBottom: '0.4rem' }}>
          {t('welcome.projectName')}
          {!readOnly && <span style={{ color: '#e53935' }}> {t('welcome.required')}</span>}
        </label>
        <input
          autoFocus={autoFocus && !readOnly}
          type="text"
          value={projectName}
          onChange={e => setProjectName?.(e.target.value)}
          onKeyDown={onEnterSubmit}
          disabled={readOnly}
          placeholder={t('welcome.projectNamePlaceholder')}
          style={{ ...fieldStyle, border: `1.5px solid ${projectName.trim() ? TEXT_DARK : BORDER_LIGHT}`, outline: 'none' }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: TEXT_FAINT, marginBottom: '0.4rem' }}>
          {t('welcome.clientName')}
          {!readOnly && <span style={{ color: '#e53935' }}> {t('welcome.required')}</span>}
        </label>
        <input
          type="text"
          value={clientName}
          onChange={e => { onClientNameInteract?.(); setClientName?.(e.target.value) }}
          onKeyDown={onEnterSubmit}
          disabled={readOnly}
          placeholder={t('welcome.clientNamePlaceholder')}
          style={{ ...fieldStyle, border: `1.5px solid ${clientName.trim() ? TEXT_DARK : BORDER_LIGHT}`, outline: 'none' }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: TEXT_FAINT, marginBottom: '0.4rem' }}>
          {t('welcome.location')}
        </label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation?.(e.target.value)}
          onKeyDown={onEnterSubmit}
          disabled={readOnly}
          placeholder={t('welcome.locationPlaceholder')}
          style={{ ...fieldStyle, border: `1.5px solid ${BORDER_LIGHT}` }}
        />
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: TEXT_FAINT, marginBottom: '0.4rem' }}>
          {t('welcome.date')}
        </label>
        <input
          type="date"
          value={date}
          onChange={e => setDate?.(e.target.value)}
          disabled={readOnly}
          style={{ ...fieldStyle, border: `1.5px solid ${BORDER_LIGHT}` }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: TEXT_FAINT, marginBottom: '0.4rem' }}>
          {t('welcome.roofType')}
        </label>
        <select
          value={roofType}
          onChange={e => setRoofType?.(e.target.value)}
          disabled={readOnly}
          style={{ ...fieldStyle, border: `1.5px solid ${BORDER_LIGHT}`, background: 'white', cursor: readOnly ? 'default' : 'pointer' }}
        >
          <option value="concrete">{t('roofSpec.type.concrete')}</option>
          <option value="tiles">{t('roofSpec.type.tiles')}</option>
          <option value="flat_installation">{t('roofSpec.type.flatInstallation')}</option>
          <option value="iskurit">{t('roofSpec.type.iskurit')}</option>
          <option value="insulated_panel">{t('roofSpec.type.insulatedPanel')}</option>
          <option value="mixed">{t('roofSpec.type.mixed')}</option>
        </select>
      </div>

      {/* Global purlin params are hidden for 'mixed' — they're set per-area in step 2. */}
      {(roofType === 'iskurit' || roofType === 'insulated_panel') && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: TEXT_FAINT, marginBottom: '0.4rem' }}>
              {t('roofSpec.distanceBetweenPurlins')}
            </label>
            <input
              type="number"
              value={distanceBetweenPurlins}
              onChange={e => setDistanceBetweenPurlins?.(e.target.value)}
              disabled={readOnly}
              placeholder={t('roofSpec.distancePlaceholder')}
              style={{ ...fieldStyle, border: `1.5px solid ${BORDER_LIGHT}` }}
            />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: TEXT_FAINT, marginBottom: '0.4rem' }}>
              {t('roofSpec.installationOrientation')}
            </label>
            <select
              value={installationOrientation}
              onChange={e => setInstallationOrientation?.(e.target.value)}
              disabled={readOnly}
              style={{ ...fieldStyle, border: `1.5px solid ${BORDER_LIGHT}`, background: 'white', cursor: readOnly ? 'default' : 'pointer' }}
            >
              <option value="perpendicular">{t('roofSpec.orientation.perpendicular')}</option>
              <option value="parallel">{t('roofSpec.orientation.parallel')}</option>
            </select>
          </div>
        </>
      )}

      {!readOnly && onSubmit && (
        <>
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            style={{
              width: '100%', padding: '0.75rem',
              background: canSubmit ? PRIMARY : BORDER_LIGHT,
              color: canSubmit ? TEXT : TEXT_VERY_LIGHT,
              border: 'none', borderRadius: '8px',
              cursor: canSubmit ? 'pointer' : 'default',
              fontWeight: 700, fontSize: '0.95rem',
              transition: 'background 0.15s',
            }}
          >
            {submitLabel ?? t('welcome.startPlanning')}
          </button>
          {!appConfigReady && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginTop: '0.5rem', fontSize: '0.75rem', color: TEXT_FAINT }}>
              <svg width="14" height="14" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              {t('welcome.loadingSettings')}
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}
        </>
      )}
    </div>
  )
}
