import { useState, useEffect } from 'react'
import { useLang } from '../../i18n/LangContext'
import { approvePlan } from '../../services/projectsApi'
import {
  PRIMARY, PRIMARY_BG, PRIMARY_DARK,
  TEXT, TEXT_SECONDARY, TEXT_MUTED, TEXT_VERY_LIGHT,
  BORDER, BORDER_FAINT,
  BG_LIGHT, BG_FAINT,
  SUCCESS, SUCCESS_BG, SUCCESS_DARK,
  AMBER_DARK, AMBER_BG, AMBER_BORDER,
} from '../../styles/colors'

export default function Step4PlanApproval({ user, projectId, onEnsureSaved, planApproval, onApprovalChange }) {
  const { t } = useLang()
  const isApproved = !!(planApproval?.strictConsent)

  const [consent, setConsent] = useState(planApproval?.strictConsent ?? false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState(null)

  // Keep local form in sync when planApproval is reset externally
  useEffect(() => {
    if (!planApproval) setConsent(false)
  }, [planApproval]) // eslint-disable-line react-hooks/exhaustive-deps

  const canApprove = consent && !saving

  const callEndpoint = async (strictConsent) => {
    setSaving(true)
    setError(null)
    try {
      const id = projectId ?? await onEnsureSaved()
      const planApproval = await approvePlan(id, strictConsent)
      onApprovalChange(planApproval ?? null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = () => { if (canApprove) callEndpoint(true) }

  const handleReset = () => {
    if (!confirm(t('step5.resetWarning'))) return
    callEndpoint(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', background: BG_FAINT, padding: '2rem',
    }}>
      <div style={{
        width: '100%', maxWidth: 560,
        background: 'white', borderRadius: 10,
        border: `1px solid ${BORDER}`,
        boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ background: PRIMARY_BG, borderBottom: `1px solid ${BORDER_FAINT}`, padding: '1.5rem 2rem' }}>
          <div style={{ fontSize: '1.25rem', fontWeight: '700', color: PRIMARY_DARK }}>{t('step5.title')}</div>
          <div style={{ fontSize: '0.85rem', color: TEXT_SECONDARY, marginTop: '0.35rem', lineHeight: 1.5 }}>
            {t('step5.subtitle')}
          </div>
        </div>

        <div style={{ padding: '1.75rem 2rem' }}>

          {isApproved ? (
            /* ── Approved state ── */
            <div>
              <div style={{
                background: SUCCESS_BG, border: `1px solid ${SUCCESS}`,
                borderRadius: 8, padding: '1.25rem 1.5rem',
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
              }}>
                <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>✓</span>
                <div>
                  <div style={{ fontWeight: '700', color: SUCCESS_DARK, fontSize: '1rem' }}>
                    {t('step5.approved')}
                  </div>
                  <div style={{ color: TEXT_SECONDARY, fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {t('step5.approvedBy', {
                      performedByName: planApproval.performedBy?.fullName ?? planApproval.performedBy?.email ?? '',
                      date:            planApproval.date,
                    })}
                  </div>
                </div>
              </div>

              <button
                onClick={handleReset}
                style={{
                  marginTop: '1.25rem', padding: '0.5rem 1.25rem',
                  background: AMBER_BG, border: `1px solid ${AMBER_BORDER}`,
                  borderRadius: 6, color: AMBER_DARK,
                  fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer',
                }}
              >
                {t('step5.reset')}
              </button>
            </div>

          ) : (
            /* ── Approval form ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

              {/* Logged-in user (auto-captured, read-only) */}
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: TEXT_MUTED, marginBottom: '0.3rem' }}>
                  {t('step5.performedBy')}
                </label>
                <div style={{
                  padding: '0.5rem 0.75rem', fontSize: '0.9rem',
                  border: `1px solid ${BORDER_FAINT}`, borderRadius: 6,
                  background: BG_FAINT, color: TEXT_SECONDARY,
                }}>
                  {user?.full_name ? `${user.full_name} (${user.email})` : user?.email ?? '—'}
                </div>
              </div>

              {/* Consent checkbox */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                  style={{ marginTop: '0.15rem', width: 16, height: 16, cursor: 'pointer', accentColor: PRIMARY_DARK }}
                />
                <span style={{ fontSize: '0.88rem', color: TEXT, lineHeight: 1.55 }}>
                  {t('step5.consent')}
                </span>
              </label>

              {error && (
                <div style={{ fontSize: '0.82rem', color: '#c62828' }}>{error}</div>
              )}

              {/* Approve button */}
              <button
                onClick={handleApprove}
                disabled={!canApprove}
                style={{
                  marginTop: '0.5rem',
                  padding: '0.7rem 1.75rem',
                  background: canApprove ? PRIMARY_DARK : BG_LIGHT,
                  border: `1px solid ${canApprove ? PRIMARY_DARK : BORDER}`,
                  borderRadius: 7,
                  color: canApprove ? 'white' : TEXT_VERY_LIGHT,
                  fontSize: '0.95rem', fontWeight: '700',
                  cursor: canApprove ? 'pointer' : 'not-allowed',
                  alignSelf: 'flex-start',
                }}
              >
                {saving ? '…' : t('step5.approve')}
              </button>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{
          borderTop: `1px solid ${BORDER_FAINT}`,
          padding: '1rem 2rem',
          background: BG_FAINT,
          fontSize: '0.75rem',
          color: TEXT_MUTED,
          lineHeight: 1.6,
        }}>
          {t('step5.disclaimer')}
        </div>
      </div>
    </div>
  )
}
