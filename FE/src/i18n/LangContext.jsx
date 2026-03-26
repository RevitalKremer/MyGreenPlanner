import { createContext, useContext, useState, useCallback } from 'react'
import en from './en'
import he from './he'

const translations = { en, he }

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem('mgp_lang') || 'en')

  const setLang = useCallback((l) => {
    localStorage.setItem('mgp_lang', l)
    setLangState(l)
  }, [])

  const t = useCallback((key, vars = {}) => {
    const dict = translations[lang] ?? translations.en
    let str = dict[key]
    if (str === undefined) {
      console.warn(`[i18n] Missing key: "${key}" (lang: ${lang})`)
      return key
    }
    return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), str)
  }, [lang])

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used inside LangProvider')
  return ctx
}
