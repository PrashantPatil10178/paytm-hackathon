import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Search, PanelLeftClose, Flame } from 'lucide-react'
import { ResolveAIGlyph, ResolveAIMark } from '@ph/shared/brand'
import { api } from '../api'
import { useApp } from '../store'
import { STATUSES, STATUS_ORDER, type Icon } from '../meta'
import { AREAS, PAGES, areaOf, byStage, type AreaId } from '../nav'
import { cn, num, rupees } from '../lib'
import type { Autonomy, Lead, Settings, Stats, Ticket } from '../types'

const AUTONOMY: Record<Autonomy, string> = { suggest: 'Suggest only', approval: 'Act with approval', autonomous: 'Fully autonomous' }

// Where you last were in each area (path and filters), so going back to an area lands you there.
const lastVisited = new Map<AreaId, string>()

/* ------------------------------------------------------------------------------------------------
 * Rail: the global areas. Icons only; on hover it widens over the panel to show their names.
 * ---------------------------------------------------------------------------------------------- */

export function Rail({ expandable = true, onNavigate }: { expandable?: boolean; onNavigate?: () => void }) {
  const { approvals } = useApp()
  const { pathname, search } = useLocation()
  const current = areaOf(pathname)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = approvals.pending.length

  useEffect(() => { lastVisited.set(current.id, pathname + search) }, [current.id, pathname, search])
  useEffect(() => () => clearTimeout(timer.current), [])

  // A short delay, so sweeping the pointer across the rail on the way somewhere doesn't open it.
  const enter = () => {
    if (!expandable) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 140)
  }
  const leave = () => {
    clearTimeout(timer.current)
    setOpen(false)
  }
  const go = () => {
    leave()
    onNavigate?.()
  }
  const reveal = open ? 'opacity-100' : 'opacity-0'

  return (
    <div className="relative w-14 shrink-0">
      <div
        onMouseEnter={enter}
        onMouseLeave={leave}
        className={cn(
          'absolute inset-y-0 left-0 z-20 flex flex-col overflow-hidden border-r border-ink/[0.06] bg-tray px-2.5 py-3 transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none',
          open ? 'w-[232px] shadow-[8px_0_32px_-12px_rgb(0_0_0/0.28)]' : 'w-14',
        )}
      >
        <Link to="/" onClick={go} className="flex h-10 shrink-0 items-center gap-3 rounded-lg" aria-label="ResolveAI home">
          <span className="grid size-9 shrink-0 place-items-center"><ResolveAIMark size={30} /></span>
          <span className={cn('min-w-0 whitespace-nowrap transition-opacity duration-150', reveal)}>
            <span className="block truncate text-sm leading-tight font-semibold text-slate-950">ResolveAI</span>
            <span className="block truncate text-xs leading-tight text-slate-500">ShopKart · Control room</span>
          </span>
        </Link>

        <nav className="mt-5 flex-1 space-y-1" aria-label="Areas">
          {AREAS.map((a) => {
            const active = a.id === current.id
            const waiting = a.id === 'home' && pending > 0
            return (
              <Link
                key={a.id}
                to={active ? a.home : (lastVisited.get(a.id) ?? a.home)}
                onClick={go}
                aria-current={active ? 'page' : undefined}
                aria-label={waiting ? `${a.label}, ${pending} waiting on you` : a.label}
                title={open ? undefined : a.label}
                className={cn(
                  'group flex h-9 items-center gap-3 rounded-lg text-[13px] font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-surface text-slate-950 shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-ink/[0.08]'
                    : 'text-slate-600 hover:bg-ink/[0.05] hover:text-slate-950',
                )}
              >
                <span className="relative grid size-9 shrink-0 place-items-center">
                  <a.icon
                    className={cn(
                      'size-[18px]',
                      active ? (a.id === 'agent' ? 'text-brand-600' : 'text-slate-950') : 'text-slate-500 group-hover:text-slate-800',
                    )}
                    aria-hidden
                  />
                  {waiting && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-warn ring-2 ring-tray" aria-hidden />}
                </span>
                <span className={cn('flex-1 truncate transition-opacity duration-150', reveal)}>{a.label}</span>
                {waiting && <span className={cn('ref mr-2.5 text-[11px] text-amber-700 transition-opacity duration-150', reveal)}>{pending} waiting</span>}
              </Link>
            )
          })}
        </nav>

        <div className="flex h-10 shrink-0 items-center gap-3" title={open ? undefined : 'ShopKart support team'}>
          <span className="grid size-9 shrink-0 place-items-center">
            <span className="grid size-7 place-items-center rounded-full border border-ink/10 bg-ink/[0.05] text-[11px] font-semibold text-slate-800">SK</span>
          </span>
          <span className={cn('min-w-0 whitespace-nowrap transition-opacity duration-150', reveal)}>
            <span className="block truncate text-[13px] leading-tight font-medium text-slate-950">ShopKart support</span>
            <span className="block truncate text-[11px] leading-tight text-slate-500">Support lead</span>
          </span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------------
 * Panel: the pages of the area you are in, with live counts and what is happening there now.
 * ---------------------------------------------------------------------------------------------- */

interface NavItem {
  to: string
  label: string
  icon?: Icon
  /** Status dot shown instead of an icon, for filtered views. */
  dot?: string
  active: boolean
  count?: number
  /** Amber = waiting on a human. */
  countTone?: 'amber'
}

interface AreaContent {
  /** One live line under the area name. */
  fact: string
  groups: { label?: string; items: NavItem[] }[]
  extra?: 'live' | 'hot'
}

function SideLink({ to, label, icon: ItemIcon, dot, active, count, countTone, onNavigate }: NavItem & { onNavigate?: () => void }) {
  return (
    <li>
      <Link
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
          active ? 'bg-ink/[0.07] text-slate-950' : 'text-slate-600 hover:bg-ink/[0.04] hover:text-slate-950',
        )}
      >
        {ItemIcon ? (
          <ItemIcon className={cn('size-4 shrink-0', active ? 'text-slate-950' : 'text-slate-500 group-hover:text-slate-800')} aria-hidden />
        ) : (
          <span className="grid size-4 shrink-0 place-items-center" aria-hidden><span className={cn('size-1.5 rounded-full', dot)} /></span>
        )}
        <span className="truncate">{label}</span>
        {count != null && (countTone === 'amber' && count > 0 ? (
          <span className="ref ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">{count}</span>
        ) : (
          <span className="ref ml-auto text-[11px] text-slate-500">{count}</span>
        ))}
      </Link>
    </li>
  )
}

function Section({ label, meta, children }: { label?: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {label && (
        <p className="flex items-center justify-between px-2.5 pb-1.5 text-[11px] font-medium text-slate-400">
          {label} {meta != null && <span className="ref">{meta}</span>}
        </p>
      )}
      <ul className="space-y-px">{children}</ul>
    </div>
  )
}

const ROW = 'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-slate-600 transition-colors hover:bg-ink/[0.04] hover:text-slate-950'

/** Conversations the agent has open right now. */
function LiveNow({ tickets, onNavigate }: { tickets: Ticket[]; onNavigate?: () => void }) {
  const live = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress')
  if (!live.length) return null
  return (
    <Section label="Live now" meta={live.length}>
      {live.map((t) => (
        <li key={t.id}>
          <Link to={`/tickets?id=${t.id}`} onClick={onNavigate} className={ROW}>
            <span className="relative flex size-1.5 shrink-0">
              {t.status === 'in_progress' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-70 motion-reduce:hidden" />}
              <span className={cn('relative inline-flex size-1.5 rounded-full', t.status === 'in_progress' ? 'bg-brand-500' : 'bg-slate-500')} />
            </span>
            <span className="truncate">{t.customer.name}</span>
            <span className="ref ml-auto text-[11px] text-slate-500">{t.id}</span>
          </Link>
        </li>
      ))}
    </Section>
  )
}

/** Leads the agent scored hot, best first. */
function HotLeads({ leads, onNavigate }: { leads: Lead[]; onNavigate?: () => void }) {
  const hot = leads.filter((l) => l.hot).sort((a, b) => b.score - a.score)
  if (!hot.length) return null
  return (
    <Section label="Hot leads" meta={hot.length}>
      {hot.map((l) => (
        <li key={l.id}>
          <Link to={`/leads?id=${l.id}`} onClick={onNavigate} className={ROW}>
            <Flame className="size-3.5 shrink-0 text-amber-600" aria-hidden />
            <span className="truncate">{l.company}</span>
            <span className="ref ml-auto text-[11px] text-slate-500" aria-label={`score ${l.score}`}>{l.score}</span>
          </Link>
        </li>
      ))}
    </Section>
  )
}

/** Aria's status and the share of queries the AI solved over the last two weeks. */
function AriaCard({ settings, onNavigate }: { settings: Settings | null; onNavigate?: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => { api.getStats().then(setStats) }, [])
  if (!settings) return null
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const ai = stats ? sum(stats.daily.ai) : 0
  const all = stats ? ai + sum(stats.daily.human) : 0
  return (
    <Link to="/settings" onClick={onNavigate} className="mt-4 block rounded-xl border border-ink/[0.07] bg-surface p-3 transition-colors hover:border-ink/[0.12]">
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
      {stats && all > 0 && (
        <>
          <p className="mt-3 flex items-baseline justify-between text-[11px] text-slate-500">
            Solved by AI <span className="ref text-slate-500"><span className="text-slate-900">{num(ai)}</span> / {num(all)}</span>
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.06]">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(ai / all) * 100}%` }} />
          </div>
        </>
      )}
    </Link>
  )
}

/** The panel's sections for one area, and the live fact for its header. */
function useAreaContent(areaId: AreaId): AreaContent {
  const { tickets, leads, approvals, settings } = useApp()
  const { pathname, search } = useLocation()
  const params = new URLSearchParams(search)
  const [connected, setConnected] = useState<{ channels: number; apps: number } | null>(null)

  useEffect(() => {
    if (areaId !== 'connect') return
    Promise.all([api.getChannels(), api.getConnectors()]).then(([ch, co]) =>
      setConnected({
        channels: ch.channels.filter((c) => c.connected).length,
        apps: co.connectors.filter((c) => c.status === 'connected').length,
      }),
    )
  }, [areaId])

  const page = (to: string, extra?: Partial<NavItem>): NavItem => ({ to, label: PAGES[to]!.label, icon: PAGES[to]!.icon, active: pathname === to, ...extra })

  switch (areaId) {
    case 'support': {
      const status = pathname === '/tickets' ? params.get('status') ?? 'all' : null
      const live = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length
      const waiting = tickets.filter((t) => t.status === 'waiting').length
      return {
        fact: `${live} live · ${waiting} waiting`,
        groups: [
          {
            label: 'Tickets',
            items: [
              page('/tickets', { label: 'All tickets', active: status === 'all', count: tickets.length }),
              ...STATUS_ORDER.map((s): NavItem => ({
                to: `/tickets?status=${s}`,
                label: STATUSES[s].label,
                dot: STATUSES[s].dot,
                active: status === s,
                count: tickets.filter((t) => t.status === s).length,
                countTone: s === 'waiting' ? 'amber' : undefined,
              })),
            ],
          },
          { label: 'Views', items: [page('/board')] },
        ],
        extra: 'live',
      }
    }
    case 'sales': {
      const stage = pathname === '/leads' ? params.get('stage') ?? 'all' : null
      const stages = [...new Set(leads.map((l) => l.stage))].sort(byStage)
      const pipeline = leads.reduce((sum, l) => sum + l.value, 0)
      return {
        fact: `${rupees(pipeline)} in pipeline`,
        groups: [
          {
            label: 'Pipeline',
            items: [
              page('/leads', { label: 'All leads', active: stage === 'all', count: leads.length }),
              ...stages.map((s): NavItem => ({
                to: `/leads?stage=${encodeURIComponent(s)}`,
                label: s,
                dot: 'bg-slate-400',
                active: stage === s,
                count: leads.filter((l) => l.stage === s).length,
              })),
            ],
          },
        ],
        extra: 'hot',
      }
    }
    case 'connect':
      return {
        fact: connected ? `${connected.channels} channels · ${connected.apps} apps connected` : 'Where Aria listens and acts',
        groups: [{ items: [page('/channels'), page('/connectors')] }],
      }
    case 'agent':
      return {
        fact: settings ? AUTONOMY[settings.autonomy] : 'Your AI teammate',
        groups: [{ items: [page('/settings'), page('/audit')] }],
      }
    case 'home': {
      const pending = approvals.pending.length
      return {
        fact: pending ? `${pending} waiting on you` : 'Nothing waiting on you',
        groups: [{ items: [page('/'), page('/approvals', { count: pending, countTone: 'amber' })] }],
        extra: 'live',
      }
    }
  }
}

export function AreaPanel({ onSearch, onCollapse, onNavigate }: { onSearch: () => void; onCollapse?: () => void; onNavigate?: () => void }) {
  const { tickets, leads, settings } = useApp()
  const { pathname } = useLocation()
  const area = areaOf(pathname)
  const { fact, groups, extra } = useAreaContent(area.id)

  return (
    <div className="flex h-full w-[232px] shrink-0 flex-col border-r border-ink/[0.06] bg-canvas px-3 pt-3 pb-4">
      <div className="flex items-start gap-2 px-1">
        <div key={area.id} className="min-w-0 flex-1 animate-rise py-1">
          <h2 className="truncate text-[15px] leading-tight font-semibold tracking-[-0.01em] text-slate-950">{area.label}</h2>
          <p className="ref mt-1 truncate text-[11px] text-slate-500">{fact}</p>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950"
            aria-label="Hide sidebar"
            title="Hide sidebar"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      <button
        onClick={onSearch}
        className="mt-4 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] text-slate-500 transition-colors hover:bg-ink/[0.04] hover:text-slate-800"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="font-mono text-[10px] text-slate-400">⌘K</kbd>
      </button>

      <nav key={area.id} className="scrollbar-thin mt-4 flex-1 animate-fade-in space-y-5 overflow-y-auto" aria-label={area.label}>
        {groups.map((g, i) => (
          <Section key={g.label ?? i} label={g.label}>
            {g.items.map((item) => <SideLink key={item.to} {...item} onNavigate={onNavigate} />)}
          </Section>
        ))}
        {extra === 'live' && <LiveNow tickets={tickets} onNavigate={onNavigate} />}
        {extra === 'hot' && <HotLeads leads={leads} onNavigate={onNavigate} />}
      </nav>

      <AriaCard settings={settings} onNavigate={onNavigate} />
    </div>
  )
}
