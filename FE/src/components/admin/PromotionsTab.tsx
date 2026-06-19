import { useState, useEffect } from 'react'
import { getSettings, updateSetting } from '../../services/adminApi'
import PromoBanner from '../PromoBanner'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

const KEYS = ['promoMessageEn', 'promoMessageHe', 'promoCtaLabelEn', 'promoCtaLabelHe', 'promoCtaUrl', 'promoCtaEmail', 'promoExpiresAt'] as const
const MSG_MAX = 200  // promo message length cap
const CTA_MAX = 20   // CTA button label length cap

export default function PromotionsTab() {
  const { t } = useLang()
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSettings()
      .then((data: any[]) => {
        const map: Record<string, string> = {}
        for (const s of data) if (KEYS.includes(s.key)) map[s.key] = s.value_json ?? ''
        setValues(map)
      })
      .catch(() => setError(t('admin.promo.failedLoad')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (k: string, v: string) => { setValues(p => ({ ...p, [k]: v })); setSaved(false) }

  // Persist the given values (value_json holds each string).
  const persist = async (vals: Record<string, string>) => {
    setSaving(true); setError(null); setSaved(false)
    try {
      await Promise.all(KEYS.map(k => updateSetting(k, { value_json: vals[k] ?? '' })))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: any) {
      setError(err?.message || t('admin.promo.failedSave'))
    } finally {
      setSaving(false)
    }
  }

  const save = () => persist(values)
  // Clear empties all fields AND saves immediately (removes the live banner).
  const clearAll = () => {
    const empty = Object.fromEntries(KEYS.map(k => [k, ''])) as Record<string, string>
    setValues(empty)
    persist(empty)
  }

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT, fontSize: '0.88rem' }}>{t('admin.common.loading')}</div>

  const labelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: 700, color: TEXT_SECONDARY, marginBottom: '0.3rem', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '0.5rem 0.7rem', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 8, fontSize: '0.88rem', outline: 'none' }
  const counterStyle = { fontWeight: 400, color: TEXT_VERY_LIGHT, fontSize: '0.7rem' }

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ fontSize: '0.82rem', color: TEXT_LIGHT, marginBottom: '1rem', lineHeight: 1.5 }}>
        {t('admin.promo.help')}
      </div>

      {/* Live preview of the green banner — both languages. */}
      <div style={{ marginBottom: '1.25rem', border: `1px dashed ${BORDER_LIGHT}`, borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0.4rem 0.7rem', background: BG_SUBTLE }}>
          {t('admin.promo.preview')}
        </div>
        {([
          { lng: 'en', label: t('admin.promo.messageEn'), msg: values.promoMessageEn },
          { lng: 'he', label: t('admin.promo.messageHe'), msg: values.promoMessageHe },
        ] as const).map(({ lng, label, msg }) => (
          <div key={lng} style={{ borderTop: `1px solid ${BORDER_LIGHT}` }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 700, color: TEXT_VERY_LIGHT, padding: '0.25rem 0.7rem' }}>{label}</div>
            {msg?.trim()
              ? <PromoBanner promo={values} lang={lng} ignoreExpiry />
              : <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: TEXT_VERY_LIGHT }}>{t('admin.promo.previewEmpty')}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
        <div>
          <label style={labelStyle}>{t('admin.promo.messageEn')} <span style={counterStyle}>{(values.promoMessageEn ?? '').length}/{MSG_MAX}</span></label>
          <textarea rows={2} maxLength={MSG_MAX} value={values.promoMessageEn ?? ''} onChange={e => set('promoMessageEn', e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div>
          <label style={labelStyle}>{t('admin.promo.messageHe')} <span style={counterStyle}>{(values.promoMessageHe ?? '').length}/{MSG_MAX}</span></label>
          <textarea rows={2} maxLength={MSG_MAX} value={values.promoMessageHe ?? ''} onChange={e => set('promoMessageHe', e.target.value)} dir="rtl" style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
        <div>
          <label style={labelStyle}>{t('admin.promo.ctaLabelEn')} <span style={counterStyle}>{(values.promoCtaLabelEn ?? '').length}/{CTA_MAX}</span></label>
          <input type="text" maxLength={CTA_MAX} value={values.promoCtaLabelEn ?? ''} onChange={e => set('promoCtaLabelEn', e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t('admin.promo.ctaLabelHe')} <span style={counterStyle}>{(values.promoCtaLabelHe ?? '').length}/{CTA_MAX}</span></label>
          <input type="text" maxLength={CTA_MAX} value={values.promoCtaLabelHe ?? ''} onChange={e => set('promoCtaLabelHe', e.target.value)} dir="rtl" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t('admin.promo.ctaUrl')}</label>
          <input type="url" placeholder="https://…" value={values.promoCtaUrl ?? ''} onChange={e => set('promoCtaUrl', e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>{t('admin.promo.ctaEmail')}</label>
          <input type="email" placeholder="name@example.com" value={values.promoCtaEmail ?? ''} onChange={e => set('promoCtaEmail', e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, marginTop: '0.5rem' }}>{t('admin.promo.ctaNote')}</div>

      {/* Expiration date — banner hides after this day. Empty = no expiry. */}
      <div style={{ marginTop: '1rem' }}>
        <label style={labelStyle}>{t('admin.promo.expiresAt')}</label>
        <input type="date" value={values.promoExpiresAt ?? ''} onChange={e => set('promoExpiresAt', e.target.value)} style={{ ...inputStyle, maxWidth: 220 }} />
        <div style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, marginTop: '0.3rem' }}>{t('admin.promo.expiresNote')}</div>
      </div>

      {error && <div style={{ marginTop: '0.85rem', padding: '0.55rem 0.75rem', background: ERROR_BG, color: ERROR, borderRadius: 8, fontSize: '0.82rem' }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1.1rem' }}>
        <button
          onClick={save}
          disabled={saving}
          style={{ padding: '0.55rem 1.4rem', background: saving ? BORDER_LIGHT : PRIMARY, color: saving ? TEXT_VERY_LIGHT : TEXT, border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.88rem', cursor: saving ? 'default' : 'pointer' }}
        >{saving ? t('admin.common.loading') : t('admin.common.save')}</button>
        <button
          onClick={clearAll}
          disabled={saving}
          style={{ padding: '0.55rem 1.1rem', background: 'white', color: TEXT_SECONDARY, border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 8, fontWeight: 700, fontSize: '0.85rem', cursor: saving ? 'default' : 'pointer' }}
        >{t('admin.common.clear')}</button>
        {saved && <span style={{ color: SUCCESS, fontWeight: 700, fontSize: '0.83rem', background: SUCCESS_BG, padding: '0.3rem 0.7rem', borderRadius: 7 }}>{t('admin.common.saved')}</span>}
      </div>
    </div>
  )
}
