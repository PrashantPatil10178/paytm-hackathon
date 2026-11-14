import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'

// Light / dark. The choice is saved per browser; until someone picks, it follows the OS.
// index.html applies the same rule before first paint, so there's no flash on load.
const KEY = 'resolveai-theme'
const query = () => window.matchMedia('(prefers-color-scheme: dark)')

const ThemeContext = createContext({ theme: 'system', resolved: 'light', setTheme: () => {}, toggle: () => {} })
export const useTheme = () => useContext(ThemeContext)

function readSaved() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeProvider({ children }) {
  const [theme, setPref] = useState(readSaved)
  const [system, setSystem] = useState(() => (query().matches ? 'dark' : 'light'))
  const resolved = theme === 'system' ? system : theme

  useEffect(() => {
    const m = query()
    const h = (e) => setSystem(e.matches ? 'dark' : 'light')
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved
  }, [resolved])

  const setTheme = useCallback((next) => {
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
