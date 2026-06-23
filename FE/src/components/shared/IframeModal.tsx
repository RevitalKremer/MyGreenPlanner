import { useLang } from '../../i18n/LangContext'
import { TEXT, TEXT_MUTED, BORDER, BLUE } from '../../styles/colors'

// In-app modal that embeds an external page (e.g. a Sadot Energy product page)
// in an iframe, so the user doesn't leave the app. Includes an "open in new
// tab" fallback for pages that refuse framing.
export default function IframeModal({ url, title, onClose }: { url: string; title?: string; onClose: () => void }) {
  const { t } = useLang()
  if (!url) return null
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1000, height: '85vh', background: 'white', borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.7rem 1rem', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ flex: 1, fontWeight: 700, color: TEXT, fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.82rem', color: BLUE, textDecoration: 'none', whiteSpace: 'nowrap' }}>{t('common.openNewTab')} ↗</a>
          <button onClick={onClose} aria-label={t('common.cancel')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', lineHeight: 1, color: TEXT_MUTED }}>×</button>
        </div>
        <iframe src={url} title={title || 'Sadot Energy'} style={{ flex: 1, width: '100%', border: 'none' }} />
      </div>
    </div>
  )
}
