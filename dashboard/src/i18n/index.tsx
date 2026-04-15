import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import en from './locales/en.json'
import zh from './locales/zh.json'

export type Locale = 'en' | 'zh'

const messages: Record<Locale, Record<string, Record<string, string>>> = { en, zh }

interface I18nContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split('.')
  let current: unknown = obj
  for (const k of keys) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[k]
  }
  return typeof current === 'string' ? current : undefined
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem('locale')
    return saved === 'en' || saved === 'zh' ? saved : (navigator.language.startsWith('zh') ? 'zh' : 'en')
  })

  const t = useCallback((key: string, params?: Record<string, string | number>) => {
    let value = getNestedValue(messages[locale], key) ?? getNestedValue(messages.en, key) ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(`{${k}}`, String(v))
      }
    }
    return value
  }, [locale])

  const handleSetLocale = useCallback((l: Locale) => {
    setLocale(l)
    localStorage.setItem('locale', l)
  }, [])

  return (
    <I18nContext.Provider value={{ locale, setLocale: handleSetLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
