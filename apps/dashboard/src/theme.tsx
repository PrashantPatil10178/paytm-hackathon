import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'

// Light / dark. The choice is saved per browser; until someone picks, it follows the OS.
// index.html applies the same rule before first paint, so there's no flash on load.
const KEY = 'resolveai-theme'
const query = () => window.matchMedia('(prefers-color-scheme: dark)')

export type Theme = 'light' | 'dark'
export type ThemePref = Theme | 'system'

interface ThemeState {
  theme: ThemePref
  resolved: Theme
  setTheme: (next: ThemePref) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeState>({ theme: 'system', resolved: 'light', setTheme: () => {}, toggle: () => {} })
export const useTheme = () => useContext(ThemeContext)

function readSaved(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setPref] = useState<ThemePref>(readSaved)
  const [system, setSystem] = useState<Theme>(() => (query().matches ? 'dark' : 'light'))
  const resolved = theme === 'system' ? system : theme

  useEffect(() => {
    const m = query()
    const h = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setTheme = useCallback((next: ThemePref) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch { /* private mode: still switch for this visit */ }
    const apply = () => flushSync(() => setPref(next))
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (document.startViewTransition && !calm) document.startViewTransition(apply)
    else apply()
  }, [])

  const toggle = useCallback(() => setTheme(resolved === 'dark' ? 'light' : 'dark'), [resolved, setTheme])

  const value = useMemo(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
