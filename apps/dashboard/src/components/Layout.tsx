import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Search, Menu, X, Bell, Sun, Moon, PanelLeftOpen } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { useApp } from '../store'
import { useTheme } from '../theme'
import { PAGES, areaOf } from '../nav'
import { cn } from '../lib'
import { Toaster } from './ui'
import CommandPalette from './CommandPalette'
import { AreaPanel, Rail } from './Sidebar'

// Ask Aria stays open across visits on this browser, like the theme.
// CopilotKit is heavier than the rest of the dashboard together: load it on first open only.
const AskAria = lazy(() => import('../copilot/AskAria'))
const ARIA_KEY = 'resolveai-aria-open'
// Whether the area panel (the inner sidebar) is hidden, so only the rail shows.
const PANEL_KEY = 'resolveai-panel-hidden'

const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1' } catch { return false } }
const saveFlag = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0') } catch { /* private mode */ } }

function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'
  const Icon = resolved === 'dark' ? Sun : Moon
  return (
    <button
      onClick={toggle}
      className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon className="size-4" />
    </button>
  )
}

export default function Layout() {
  const { toasts, dismissToast, approvals } = useApp()
  const [mobileNav, setMobileNav] = useState(false)
  const [palette, setPalette] = useState(false)
  const [panelHidden, setPanelHidden] = useState(() => readFlag(PANEL_KEY))
  const [aria, setAria] = useState(() => readFlag(ARIA_KEY))
  const [ariaLoaded, setAriaLoaded] = useState(aria)
  if (aria && !ariaLoaded) setAriaLoaded(true)
  const location = useLocation()
  const area = areaOf(location.pathname)
  const page = PAGES[location.pathname]?.label ?? 'Overview'
  const pending = approvals.pending.length

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'k') { e.preventDefault(); setPalette((p) => !p) }
      if (k === 'j') { e.preventDefault(); setAria((a) => !a) }
      if (k === 'b') { e.preventDefault(); setPanelHidden((h) => !h) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  useEffect(() => saveFlag(ARIA_KEY, aria), [aria])
  useEffect(() => saveFlag(PANEL_KEY, panelHidden), [panelHidden])

  const openSearch = () => { setMobileNav(false); setPalette(true) }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden lg:flex">
        <Rail />
        {!panelHidden && <AreaPanel onSearch={openSearch} onCollapse={() => setPanelHidden(true)} />}
      </aside>

      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={() => setMobileNav(false)} />
          <div className="relative flex h-full w-fit animate-rise">
            <Rail expandable={false} onNavigate={() => setMobileNav(false)} />
            <AreaPanel onSearch={openSearch} onNavigate={() => setMobileNav(false)} />
            <button className="absolute top-4 -right-11 cursor-pointer rounded-lg border border-ink/10 bg-surface p-1.5 text-slate-800" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="size-5" /></button>
          </div>
        </div>
      )}

      <div className={cn('transition-[padding] duration-300 motion-reduce:transition-none', panelHidden ? 'lg:pl-14' : 'lg:pl-[288px]', aria && 'xl:pr-[420px]')}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink/[0.06] bg-canvas/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button className="-ml-1.5 cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-ink/[0.06] hover:text-slate-950 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          {panelHidden && (
            <button
              className="-ml-1.5 hidden cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-ink/[0.06] hover:text-slate-950 lg:block"
              onClick={() => setPanelHidden(false)}
              aria-label="Show sidebar"
              title="Show sidebar (⌘B)"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="hidden text-slate-500 sm:inline">ShopKart</span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden>/</span>
            {area.label !== page && (
              <>
                <span className="hidden text-slate-500 sm:inline">{area.label}</span>
                <span className="hidden text-slate-300 sm:inline" aria-hidden>/</span>
              </>
            )}
            <span className="truncate font-medium text-slate-950" aria-current="page">{page}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setPalette(true)}
              className="flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-ink/[0.08] bg-ink/[0.03] px-2.5 text-[13px] text-slate-500 transition-colors hover:border-ink/[0.14] hover:text-slate-800 sm:w-72"
              aria-label="Search"
            >
              <Search className="size-4" />
              <span className="hidden flex-1 truncate text-left sm:inline">Search tickets, leads, pages…</span>
              <kbd className="hidden rounded border border-ink/10 bg-ink/[0.04] px-1.5 font-mono text-[10px] text-slate-500 sm:inline">⌘K</kbd>
            </button>
            <button
              onClick={() => setAria((a) => !a)}
              className={cn(
                'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors',
                aria ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-ink/[0.08] text-slate-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700',
              )}
              aria-pressed={aria}
              title="Ask Aria (⌘J)"
            >
              <ResolveAIGlyph className="size-4 text-brand-600" />
              <span className="hidden md:inline">Ask Aria</span>
            </button>
            <ThemeToggle />
            <Link
              to="/approvals"
              className="relative grid size-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950"
              aria-label={pending ? `${pending} approvals waiting` : 'Approvals'}
            >
              <Bell className="size-4" />
              {pending > 0 && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-warn ring-2 ring-canvas" />}
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>

      {ariaLoaded && <Suspense fallback={null}><AskAria open={aria} onClose={() => setAria(false)} /></Suspense>}
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toaster toasts={toasts} dismiss={dismissToast} className={aria && 'sm:right-[436px]'} />
    </div>
  )
}
