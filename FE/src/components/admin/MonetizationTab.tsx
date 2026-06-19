import React, { useState, useEffect } from 'react'
import { getSettings, updateSetting } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'


/**
 * Dedicated admin tab for monetization rates.
 *
 * Reuses the existing /admin/settings API but filters client-side to
 * `section='monetization'` and renders a focused row layout (no roof-type
 * filter — irrelevant here). Lives separately from the materials/construction
 * SettingsTab so finance settings aren't mixed in with engineering ones.
 *
 * Future expansion: credit packages will be a single `app_settings` row of
 * type 'array' or 'object' rendered alongside these scalars.
 */
export default function MonetizationTab() {
  const { t } = useLang()
  const [settings, setSettings] = useState<any[]>([])
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSettings()
      .then(all => {
        setSettings(all.filter(s => s.section === 'monetization'))
        setLoading(false)
      })
      .catch(() => { setError(t('admin.settings.failedLoad')); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isDirty = (s) => edits[s.key] !== undefined

  const handleSave = async (s) => {
    setSaving(p => ({ ...p, [s.key]: true }))
    try {
      let val: any = edits[s.key] !== undefined ? edits[s.key] : s.value_json
      if (s.param_type === 'number') val = Number(val)

      // Monetization rows only edit `value_json` from this UI. The
      // min/max/step bounds are app-internal admin metadata seeded by the
      // migration; they're not exposed for tweaking from here.
      const updated = await updateSetting(s.key, { value_json: val })
      setSettings(prev => prev.map(x => x.key === s.key ? updated : x))
      setEdits(p => { const n = { ...p }; delete n[s.key]; return n })
      setSaved(p => ({ ...p, [s.key]: true }))
      setTimeout(() => setSaved(p => { const n = { ...p }; delete n[s.key]; return n }), 2000)
    } catch {
      setError(t('admin.common.failedSave'))
    } finally {
      setSaving(p => ({ ...p, [s.key]: false }))
    }
  }

  if (loading) return <div style={{ padding: '2rem', color: TEXT_VERY_LIGHT }}>{t('admin.common.loading')}</div>

  const inputStyle = (dirtyField): React.CSSProperties => ({
    padding: '0.4rem 0.55rem', borderRadius: 6, fontSize: '0.88rem',
    border: `1.5px solid ${dirtyField ? TEXT_DARKEST : BORDER_LIGHT}`, outline: 'none',
    width: '100%', height: 36, boxSizing: 'border-box',
    // Kill browser default styling that varies between rows depending on
    // value/state (number spinners, autofill indicators from extensions).
    appearance: 'none' as any,
    MozAppearance: 'textfield' as any,
  })

  return (
    <div style={{ padding: '1rem 0', maxWidth: 880 }}>
      <div style={{ marginBottom: '1.1rem' }}>
        <div style={{ fontSize: '1rem', fontWeight: 800, color: TEXT_DARKEST }}>{t('admin.monetization.title')}</div>
        <div style={{ fontSize: '0.82rem', color: TEXT_VERY_LIGHT, marginTop: 2 }}>
          {t('admin.monetization.subtitle')}
        </div>
      </div>

      {error && <div style={{ padding: '0.6rem 0.8rem', background: ERROR_BG, color: ERROR, borderRadius: 8, marginBottom: '1rem', fontSize: '0.83rem' }}>{error}</div>}

      {settings.length === 0 ? (
        <div style={{ padding: '1rem', color: TEXT_VERY_LIGHT, fontSize: '0.85rem', fontStyle: 'italic' }}>
          {t('admin.monetization.empty')}
        </div>
      ) : (
        <>
          {/* Column headers — Setting / Value / Save. Min/Max/Step are admin-
              internal metadata seeded by the migration and intentionally not
              editable from this screen.
              Flex layout (not grid) so the input + Save button keep their
              intrinsic widths and the Setting cell absorbs any extra space
              consistently across rows. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.3rem 0.85rem',
          }}>
            <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.68rem', fontWeight: 700, color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.monetization.col.setting')}</div>
            <div style={{ flex: '0 0 140px', fontSize: '0.68rem', fontWeight: 700, color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('admin.monetization.col.value')}</div>
            <div style={{ flex: '0 0 64px' }} />
          </div>

          <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, overflow: 'hidden' }}>
            {settings.map((s, i) => {
              const dirty = isDirty(s)
              const displayVal = edits[s.key] !== undefined ? edits[s.key] : String(s.value_json)

              return (
                <div key={s.key} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.7rem 0.85rem', minHeight: 56,
                  background: i % 2 === 0 ? 'white' : BG_SUBTLE,
                  borderTop: i > 0 ? `1px solid ${BORDER_FAINT}` : 'none',
                }}>
                  <div style={{ flex: '1 1 auto', minWidth: 0, fontSize: '0.9rem', fontWeight: 700, color: TEXT_DARKEST }}>
                    {s.label}
                  </div>
                  <input
                    value={displayVal}
                    onChange={e => setEdits(p => ({ ...p, [s.key]: e.target.value }))}
                    type="number"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    style={{ ...inputStyle(edits[s.key] !== undefined), flex: '0 0 140px', width: 140 }}
                  />
                  <button
                    onClick={() => handleSave(s)}
                    disabled={!dirty || saving[s.key]}
                    title={saved[s.key] ? t('admin.common.saved') : t('admin.common.save')}
                    style={{
                      flex: '0 0 36px', height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'none', border: 'none', cursor: dirty && !saving[s.key] ? 'pointer' : 'default',
                      color: saved[s.key] ? SUCCESS : dirty ? PRIMARY : TEXT_VERY_LIGHT,
                    }}
                  >
                    {saving[s.key]
                      ? <span style={{ fontSize: '0.85rem' }}>…</span>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
