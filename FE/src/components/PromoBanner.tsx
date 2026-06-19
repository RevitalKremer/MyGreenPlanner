import { SUCCESS, SUCCESS_BG, SUCCESS_DARK } from '../styles/colors'
import { useLang } from '../i18n/LangContext'

/**
 * Green promo banner driven by admin-set app_settings (the Promotions page).
 * Shows the message for the current language; renders nothing when empty. A CTA
 * button appears only when a URL or email is configured (URL wins over email).
 *
 * `promo` is the appDefaults map (key → value_json), e.g. promoMessageEn etc.
 */
export default function PromoBanner({ promo = null, lang: langOverride = null, ignoreExpiry = false }) {
  const { lang: uiLang, t } = useLang()
  const lang = langOverride || uiLang
  if (!promo) return null

  const message = (lang === 'he' ? promo.promoMessageHe : promo.promoMessageEn) || ''
  if (!message.trim()) return null

  // Expiry: hide once now passes the expiration day (inclusive). Empty = no expiry.
  const expiresAt = (promo.promoExpiresAt || '').trim()
  if (!ignoreExpiry && expiresAt && new Date() >= new Date(`${expiresAt}T23:59:59`)) return null

  const ctaLabel = ((lang === 'he' ? promo.promoCtaLabelHe : promo.promoCtaLabelEn) || '').trim()
  const url = (promo.promoCtaUrl || '').trim()
  const email = (promo.promoCtaEmail || '').trim()
  const href = url ? url : (email ? `mailto:${email}` : null)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
      gap: '0.7rem', padding: '0.5rem 1rem',
      background: SUCCESS_BG, color: SUCCESS_DARK, borderBottom: `1px solid ${SUCCESS}`,
      fontSize: '0.84rem', fontWeight: 600,
    }}>
      <span>{message}</span>
      {href && (
        <a
          href={href}
          target={url ? '_blank' : undefined}
          rel={url ? 'noopener noreferrer' : undefined}
          style={{
            background: SUCCESS, color: 'white', borderRadius: 6, padding: '0.2rem 0.8rem',
            fontWeight: 700, fontSize: '0.78rem', textDecoration: 'none', whiteSpace: 'nowrap',
          }}
        >{ctaLabel || t('promo.cta')}</a>
      )}
    </div>
  )
}
