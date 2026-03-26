import { useLang } from './LangContext'

const LANGS = [
  { code: 'en', flag: '🇺🇸' },
  { code: 'he', flag: '🇮🇱' },
]

// dark=true → for dark header; dark=false → for light welcome screen
export default function LangToggle({ dark = true }) {
  const { lang, setLang } = useLang()
  const current = LANGS.find(l => l.code === lang) ?? LANGS[0]

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span style={{
        position: 'absolute', left: '0.45rem',
        fontSize: '1rem', lineHeight: 1, pointerEvents: 'none',
      }}>
        {current.flag}
      </span>
      <select
        value={lang}
        onChange={e => setLang(e.target.value)}
        style={{
          appearance: 'none', WebkitAppearance: 'none',
          background: 'transparent',
          border: `1px solid ${dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.15)'}`,
          borderRadius: '6px',
          color: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)',
          cursor: 'pointer',
          fontSize: '0.78rem',
          fontWeight: '600',
          padding: '0.22rem 1.5rem 0.22rem 1.85rem',
          outline: 'none',
        }}
      >
        {LANGS.map(({ code }) => (
          <option key={code} value={code} style={{ color: '#222', background: 'white' }}>
            {code.toUpperCase()}
          </option>
        ))}
      </select>
      <span style={{
        position: 'absolute', right: '0.35rem',
        fontSize: '0.55rem', lineHeight: 1, pointerEvents: 'none',
        color: dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.35)',
      }}>
        ▾
      </span>
    </div>
  )
}
