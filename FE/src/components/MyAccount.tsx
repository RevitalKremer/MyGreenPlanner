import React, { useEffect, useState } from 'react'
import {
  PRIMARY, PRIMARY_BG, TEXT, TEXT_DARKEST, TEXT_DARK, TEXT_MUTED, TEXT_FAINT,
  TEXT_VERY_LIGHT, TEXT_SECONDARY,
  BORDER_LIGHT, BORDER_FAINT, BG_FAINT, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
  MODAL_SCRIM, MODAL_SHADOW,
} from '../styles/colors'
import { useLang } from '../i18n/LangContext'


/**
 * My Account — credits balance + history + inline profile edit.
 * Admins never reach this modal in their own UX (their role-specific console
 * is the Admin credits console, Phase 4 of the credits feature).
 *
 * Props:
 *   user             — auth.user object (must include credits_available/used/total)
 *   onClose          — close handler
 *   onRefresh        — async () => Promise<void>, refetches /auth/me.
 *                      Called on mount + manual click of the "Refresh" button.
 *   onUpdateProfile  — async ({full_name, phone_number}) => updated user.
 *                      Optional; when omitted, the Edit-profile button is hidden.
 *   contactEmail     — shown in the "request top-up" hint (currently company
 *                      support email until payments land)
 */
export default function MyAccount({ user, onClose, onRefresh, onUpdateProfile = null, onSignOut = null, contactEmail = 'support@mygreenplanner.com' }) {
  const { t } = useLang()
  // Inline profile editor — toggled by the "Edit profile" button on the user
  // row. Keeps everything in one modal instead of nesting a second one.
  const [editingProfile, setEditingProfile] = useState(false)
  const [fullNameInput, setFullNameInput] = useState(user?.full_name ?? '')
  const [phoneInput, setPhoneInput] = useState(user?.phone_number ?? '')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  // Sync the form when the user prop refreshes from /auth/me.
  useEffect(() => {
    if (!editingProfile) {
      setFullNameInput(user?.full_name ?? '')
      setPhoneInput(user?.phone_number ?? '')
    }
  }, [user?.full_name, user?.phone_number, editingProfile])

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!onUpdateProfile || !fullNameInput.trim()) return
    setProfileError(null); setProfileSaved(false); setProfileSaving(true)
    try {
      await onUpdateProfile({
        full_name: fullNameInput.trim(),
        phone_number: phoneInput.trim() || null,
      })
      setProfileSaved(true)
      // Collapse the editor a moment after a successful save so the user
      // sees the success state, then returns to the calm balance view.
      setTimeout(() => { setProfileSaved(false); setEditingProfile(false) }, 1500)
    } catch (err: any) {
      setProfileError(err?.message || 'Save failed')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleCancelProfileEdit = () => {
    setEditingProfile(false)
    setProfileError(null)
    setProfileSaved(false)
    setFullNameInput(user?.full_name ?? '')
    setPhoneInput(user?.phone_number ?? '')
  }

  // Pull a fresh /auth/me when the modal opens — covers the case where an
  // admin granted/refunded credits while this tab was idle.
  useEffect(() => {
    if (onRefresh) {
      onRefresh().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Credits view is windowed to the current calendar year (used / total /
  // plans). `available` is the lifetime wallet balance.
  const available       = user?.credits_available ?? 0
  const used            = user?.credits_used ?? 0
  const total           = user?.credits_total ?? 0
  const plansThisYear     = user?.plans_this_year ?? 0
  const discountEligible  = !!user?.discount_eligible
  const discountThreshold = Number(user?.discount_threshold ?? 0)
  const periodYear        = user?.period_year || new Date().getFullYear()
  // Progress toward volume-discount tier, capped at 1. Below 75% we show
  // nothing (no clutter); 75–99% gets an amber "almost there" pill; ≥100%
  // gets the existing green "eligible" pill.
  const discountProgress = discountThreshold > 0
    ? Math.min(plansThisYear / discountThreshold, 1)
    : 0
  const discountTier: 'far' | 'near' | 'eligible' =
    discountEligible          ? 'eligible' :
    discountProgress >= 0.75  ? 'near'     : 'far'

  const StatBox = ({ label, value, accent = false }) => (
    <div style={{
      flex: 1,
      background: accent ? PRIMARY_BG : 'white',
      border: `1.5px solid ${accent ? PRIMARY : BORDER_LIGHT}`,
      borderRadius: 10, padding: '0.9rem 1rem',
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 0,
    }}>
      <span style={{ fontSize: '0.7rem', color: TEXT_FAINT, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: '1.6rem', fontWeight: 800, color: TEXT_DARKEST, lineHeight: 1 }}>
        {value}
      </span>
    </div>
  )

  return (
    <div style={{
      position: 'fixed', inset: 0, background: MODAL_SCRIM,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1200, padding: '1rem',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 14, padding: '1.5rem 1.75rem',
          width: 'min(560px, 100%)', maxHeight: '92vh', overflowY: 'auto',
          boxShadow: `0 12px 40px ${MODAL_SHADOW}`,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: TEXT_DARKEST }}>
            {t('account.title')}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button
              onClick={() => onRefresh && onRefresh()}
              title={t('account.refresh')}
              style={{
                background: 'none', border: `1px solid ${BORDER_LIGHT}`,
                borderRadius: 8, padding: '0.35rem 0.5rem', cursor: 'pointer',
                color: TEXT_DARK, display: 'inline-flex',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '1.4rem', lineHeight: 1, color: TEXT_FAINT, padding: '0 0.25rem',
              }}
            >×</button>
          </div>
        </div>

        {/* User row + inline profile editor.
            The row stays static when collapsed; clicking Edit profile expands
            the form below the same row card so the whole flow stays in one
            modal — no second popup. */}
        <div style={{
          background: BG_FAINT, border: `1px solid ${BORDER_FAINT}`, borderRadius: 10,
          marginBottom: '1rem',
        }}>
          <div style={{
            padding: '0.75rem 0.9rem',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: TEXT_DARKEST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.full_name}
              </div>
              <div style={{ fontSize: '0.78rem', color: TEXT_FAINT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.email}
              </div>
            </div>
            {onUpdateProfile && (
              <button
                onClick={() => editingProfile ? handleCancelProfileEdit() : setEditingProfile(true)}
                aria-expanded={editingProfile}
                style={{
                  background: editingProfile ? BORDER_FAINT : 'white',
                  border: `1.5px solid ${BORDER_LIGHT}`,
                  color: TEXT_DARK, padding: '0.4rem 0.8rem',
                  borderRadius: 7, fontSize: '0.8rem', fontWeight: 700,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                }}
              >
                {editingProfile ? t('common.cancel') : t('account.editProfile')}
                <svg
                  width="11" height="11" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: editingProfile ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>

          {editingProfile && onUpdateProfile && (
            <form
              onSubmit={handleSaveProfile}
              style={{
                padding: '0 0.9rem 0.9rem',
                borderTop: `1px solid ${BORDER_FAINT}`,
                paddingTop: '0.85rem',
                marginTop: '0.1rem',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.7rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: TEXT_SECONDARY, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t('profile.fullName')}
                  </label>
                  <input
                    type="text" value={fullNameInput}
                    onChange={e => setFullNameInput(e.target.value)}
                    placeholder={t('profile.fullNamePlaceholder')}
                    required
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0.5rem 0.65rem', borderRadius: 7,
                      border: `1.5px solid ${BORDER_LIGHT}`, fontSize: '0.88rem', outline: 'none',
                      background: 'white',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: TEXT_SECONDARY, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t('profile.phone')}
                  </label>
                  <input
                    type="tel" value={phoneInput}
                    onChange={e => setPhoneInput(e.target.value)}
                    placeholder={t('profile.phonePlaceholder')}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '0.5rem 0.65rem', borderRadius: 7,
                      border: `1.5px solid ${BORDER_LIGHT}`, fontSize: '0.88rem', outline: 'none',
                      background: 'white',
                    }}
                  />
                </div>
              </div>

              {profileError && (
                <div style={{
                  marginBottom: '0.6rem', padding: '0.45rem 0.65rem',
                  background: ERROR_BG, color: ERROR,
                  borderRadius: 7, fontSize: '0.8rem',
                }}>
                  {profileError}
                </div>
              )}
              {profileSaved && (
                <div style={{
                  marginBottom: '0.6rem', padding: '0.45rem 0.65rem',
                  background: SUCCESS_BG, color: SUCCESS,
                  borderRadius: 7, fontSize: '0.8rem',
                }}>
                  {t('profile.profileUpdated')}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleCancelProfileEdit}
                  disabled={profileSaving}
                  style={{
                    background: 'white', border: `1.5px solid ${BORDER_LIGHT}`,
                    color: TEXT_DARK, padding: '0.45rem 0.85rem',
                    borderRadius: 7, fontSize: '0.82rem', fontWeight: 700,
                    cursor: profileSaving ? 'default' : 'pointer',
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={profileSaving || !fullNameInput.trim()}
                  style={{
                    background: (profileSaving || !fullNameInput.trim()) ? BORDER_LIGHT : PRIMARY,
                    color: (profileSaving || !fullNameInput.trim()) ? TEXT_VERY_LIGHT : TEXT,
                    border: 'none', padding: '0.45rem 0.95rem',
                    borderRadius: 7, fontSize: '0.82rem', fontWeight: 700,
                    cursor: (profileSaving || !fullNameInput.trim()) ? 'default' : 'pointer',
                  }}
                >
                  {profileSaving ? t('profile.saving') : t('profile.saveChanges')}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Stat boxes — windowed to the current calendar year (except
            "available", which is the lifetime wallet balance). */}
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          marginBottom: '0.4rem',
        }}>
          <span style={{ fontSize: '0.72rem', color: TEXT_FAINT, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('account.periodLabel', { year: periodYear })}
          </span>
          {discountTier === 'eligible' && (
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, color: TEXT_DARKEST,
              background: PRIMARY_BG, border: `1px solid ${PRIMARY}`,
              padding: '0.15rem 0.5rem', borderRadius: 999,
            }}>
              {t('account.discountEligible')}
            </span>
          )}
          {discountTier === 'near' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              fontSize: '0.7rem', fontWeight: 700, color: TEXT_DARKEST,
              background: PRIMARY_BG, border: `1px solid ${PRIMARY}`,
              padding: '0.15rem 0.55rem', borderRadius: 999,
            }}>
              {/* Mini progress bar — motivational cue. Same green palette
                  as the 'eligible' pill so it reads as positive progress
                  rather than a warning. */}
              <span style={{
                display: 'inline-block', width: 44, height: 5,
                background: BORDER_FAINT, borderRadius: 3,
                position: 'relative', overflow: 'hidden',
              }}>
                <span style={{
                  position: 'absolute', inset: 0,
                  width: `${Math.round(discountProgress * 100)}%`,
                  background: PRIMARY, borderRadius: 3,
                }} />
              </span>
              {t('account.discountNearGoal', { plans: plansThisYear, threshold: discountThreshold })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.9rem' }}>
          <StatBox label={t('account.available')}       value={available} accent />
          <StatBox label={t('account.used')}            value={used} />
          <StatBox label={t('account.total')}           value={total} />
          <StatBox label={t('account.plansThisYear')}   value={plansThisYear} />
        </div>

        {/* Refund-policy notice */}
        <div style={{
          padding: '0.75rem 0.9rem', background: SUCCESS_BG,
          borderRadius: 10, fontSize: '0.82rem', color: TEXT_DARKEST,
          marginBottom: '1rem',
        }}>
          {t('account.refundNotice')}
        </div>

        {/* Buy more — disabled placeholder + contact hint */}
        <div style={{
          padding: '0.9rem 1rem', border: `1.5px dashed ${BORDER_LIGHT}`, borderRadius: 10,
          marginBottom: '0.75rem',
          display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: TEXT_DARK }}>
              {t('account.buyMore')}
            </div>
            <span style={{
              fontSize: '0.66rem', color: TEXT_FAINT, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              padding: '0.2rem 0.5rem', background: BORDER_FAINT, borderRadius: 6,
            }}>
              {t('account.comingSoon')}
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', color: TEXT_MUTED, lineHeight: 1.45 }}>
            {t('account.topUpHint')}{' '}
            <a href={`mailto:${contactEmail}`} style={{ color: TEXT_DARKEST, fontWeight: 700 }}>
              {contactEmail}
            </a>
          </div>
        </div>

        {/* Footer — Sign Out (left) + Close (right). Sign Out moved here
            from the UserChip so the avatar can collapse to just a circle. */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
          {onSignOut ? (
            <button
              onClick={onSignOut}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: TEXT_FAINT, fontSize: '0.82rem', fontWeight: 600,
                textDecoration: 'underline', padding: '0.25rem 0',
              }}
            >
              {t('user.signOut')}
            </button>
          ) : <span />}
          <button
            onClick={onClose}
            style={{
              background: TEXT_DARKEST, color: 'white', border: 'none',
              borderRadius: 8, padding: '0.55rem 1.1rem',
              fontSize: '0.88rem', fontWeight: 700, cursor: 'pointer',
            }}
          >
            {t('common.close')}
          </button>
        </div>
      </div>

    </div>
  )
}
