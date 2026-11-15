import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutGrid, Logs, Inbox, ShieldCheck, SquareKanban, Radio, Cable, SlidersHorizontal, ChartColumnBig, Megaphone,
  Search, Menu, X, Bell, Sun, Moon,
} from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { useTheme } from '../theme'
import { ResolveAIGlyph, ResolveAIMark } from '@ph/shared/brand'
import { cn, num } from '../lib'
import { Toaster } from './ui'
import CommandPalette from './CommandPalette'

// Ask Aria stays open across visits on this browser, like the theme.
// CopilotKit is heavier than the rest of the dashboard together: load it on first open only.
const AskAria = lazy(() => import('../copilot/AskAria'))
const ARIA_KEY = 'resolveai-aria-open'
const readAria = () => { try { return localStorage.getItem(ARIA_KEY) === '1' } catch { return false } }

const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Overview', icon: LayoutGrid, end: true },
    { to: '/analytics', label: 'Analytics', icon: ChartColumnBig },
    { to: '/audit', label: 'Audit', icon: Logs },
  ] },
  { group: 'Work', items: [
    { to: '/tickets', label: 'Tickets', icon: Inbox },
    { to: '/approvals', label: 'Approvals', icon: ShieldCheck, badge: 'approvals' },
    { to: '/board', label: 'Board', icon: SquareKanban },
    { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  ] },
  { group: 'Integrations', items: [
    { to: '/channels', label: 'Channels', icon: Radio },
    { to: '/connectors', label: 'Connectors', icon: Cable },
  ] },
  { group: 'Agent', items: [{ to: '/settings', label: 'Settings', icon: SlidersHorizontal }] },
]
const PAGE = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.to, i.label])))

const AUTONOMY = { suggest: 'Suggest only', approval: 'Act with approval', autonomous: 'Fully autonomous' }

/** Conversations the agent has open right now, like the reference's project list. */
function LiveNow({ tickets, onNavigate }) {
  const live = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress')
  if (!live.length) return null
  return (
    <div>
      <p className="flex items-center justify-between px-2.5 pb-1.5 text-[11px] font-medium text-slate-400">
        Live now <span className="ref">{live.length}</span>
      </p>
      <ul className="space-y-px">
        {live.map((t) => (
          <li key={t.id}>
            <Link
              to={`/tickets?id=${t.id}`}
              onClick={onNavigate}
              className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-slate-600 transition-colors hover:bg-ink/[0.04] hover:text-slate-950"
            >
              <span className="relative flex size-1.5 shrink-0">
                {t.status === 'in_progress' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-70" />}
                <span className={cn('relative inline-flex size-1.5 rounded-full', t.status === 'in_progress' ? 'bg-brand-500' : 'bg-slate-500')} />
              </span>
              <span className="truncate">{t.customer.name}</span>
              <span className="ref ml-auto text-[11px] text-slate-500">{t.id}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

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

function Sidebar({ onNavigate }) {
  const { approvals, settings, tickets } = useApp()
  const [stats, setStats] = useState(null)
  useEffect(() => { api.getStats().then(setStats) }, [])
  const pending = approvals.pending.length
  const ai = stats?.daily.ai.reduce((a, b) => a + b, 0)
  const all = stats && ai + stats.daily.human.reduce((a, b) => a + b, 0)

  return (
    <div className="flex h-full flex-col border-r border-ink/[0.06] bg-canvas px-3 py-4">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-ink/[0.03]">
        <ResolveAIMark size={32} className="shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm leading-tight font-semibold text-slate-950">ResolveAI</p>
          <p className="truncate text-xs leading-tight text-slate-500">ShopKart · Control room</p>
        </div>
      </Link>

      <nav className="scrollbar-thin mt-6 flex-1 space-y-5 overflow-y-auto" aria-label="Main">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="px-2.5 pb-1.5 text-[11px] font-medium text-slate-400">{g.group}</p>
            <ul className="space-y-px">
              {g.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                        isActive ? 'bg-ink/[0.07] text-slate-950' : 'text-slate-600 hover:bg-ink/[0.04] hover:text-slate-950',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn('size-4', isActive ? 'text-slate-950' : 'text-slate-500 group-hover:text-slate-800')} aria-hidden />
                        {item.label}
                        {item.badge === 'approvals' && pending > 0 && (
                          <span className="ref ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ring-inset" aria-label={`${pending} waiting`}>
                            {pending}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <LiveNow tickets={tickets} onNavigate={onNavigate} />
      </nav>

      {settings && (
        <NavLink to="/settings" onClick={onNavigate} className="mt-4 block rounded-xl border border-ink/[0.07] bg-surface p-3 transition-colors hover:border-ink/[0.12]">
          <div className="flex items-center gap-2.5">
            <span className="relative grid size-7 shrink-0 place-items-center rounded-lg border border-ink/[0.08] bg-ink/[0.04] text-brand-600">
              <ResolveAIGlyph className="size-5" />
              <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-brand-500 ring-2 ring-surface" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-slate-950">{settings.agentName} <span className="font-normal text-slate-500">· online</span></p>
              <p className="truncate text-[11px] text-slate-500">{AUTONOMY[settings.autonomy]}</p>
            </div>
          </div>
          {stats && (
            <>
              <p className="mt-3 flex items-baseline justify-between text-[11px] text-slate-500">
                Solved by AI <span className="ref text-slate-500"><span className="text-slate-900">{num(ai)}</span> / {num(all)}</span>
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.06]">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(ai / all) * 100}%` }} />
              </div>
            </>
          )}
        </NavLink>
      )}
    </div>
  )
}

export default function Layout() {
  const { toasts, dismissToast, approvals } = useApp()
  const [mobileNav, setMobileNav] = useState(false)
  const [palette, setPalette] = useState(false)
  const [aria, setAria] = useState(readAria)
  const [ariaLoaded, setAriaLoaded] = useState(aria)
  if (aria && !ariaLoaded) setAriaLoaded(true)
  const location = useLocation()
  const page = PAGE[location.pathname] ?? 'Overview'
  const pending = approvals.pending.length

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((p) => !p)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setAria((a) => !a)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])
  useEffect(() => { try { localStorage.setItem(ARIA_KEY, aria ? '1' : '0') } catch { /* private mode */ } }, [aria])

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block"><Sidebar /></aside>
      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={() => setMobileNav(false)} />
          <div className="relative h-full w-64 animate-rise">
            <Sidebar onNavigate={() => setMobileNav(false)} />
            <button className="absolute top-4 -right-11 cursor-pointer rounded-lg border border-ink/10 bg-surface p-1.5 text-slate-800" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="size-5" /></button>
          </div>
        </div>
      )}

      <div className={cn('transition-[padding] duration-300 lg:pl-60', aria && 'xl:pr-[420px]')}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink/[0.06] bg-canvas/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <button className="-ml-1.5 cursor-pointer rounded-lg p-1.5 text-slate-500 hover:bg-ink/[0.06] hover:text-slate-950 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="hidden text-slate-500 sm:inline">ShopKart</span>
            <span className="hidden text-slate-300 sm:inline" aria-hidden>/</span>
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
            <span className="grid size-7 place-items-center rounded-full border border-ink/10 bg-ink/[0.05] text-[11px] font-semibold text-slate-800" title="ShopKart support team">SK</span>
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
