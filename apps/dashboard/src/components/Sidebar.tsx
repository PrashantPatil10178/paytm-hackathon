import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Search, PanelLeftClose, Flame } from 'lucide-react'
import { ResolveAIGlyph, ResolveAIMark } from '@ph/shared/brand'
import { live } from '../api'
import { useApp } from '../store'
import { STATUSES, STATUS_ORDER, type Icon } from '../meta'
import { AREAS, PAGES, areaOf, byStage, stageLabel, type AreaId } from '../nav'
import { cn, initials, num, rupees } from '../lib'
import { OWNER } from '@ph/shared'
import type { Autonomy, Lead, Settings, Ticket } from '../types'

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

        <div className="flex h-10 shrink-0 items-center gap-3" title={open ? undefined : `${OWNER.name} · ${OWNER.role}, ${OWNER.business}`}>
          <span className="grid size-9 shrink-0 place-items-center">
            <span className="grid size-7 place-items-center rounded-full border border-ink/10 bg-ink/[0.05] text-[11px] font-semibold text-slate-800">{initials(OWNER.name)}</span>
          </span>
          <span className={cn('min-w-0 whitespace-nowrap transition-opacity duration-150', reveal)}>
            <span className="block truncate text-[13px] leading-tight font-medium text-slate-950">{OWNER.name}</span>
            <span className="block truncate text-[11px] leading-tight text-slate-500">{OWNER.role}, {OWNER.business}</span>
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

/** Position in the top-down cascade (see `.cascade-item` in index.css). */
const cascade = (i: number) => ({ className: 'cascade-item', style: { '--i': i } as CSSProperties })

const LINK = 'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors'
const LABEL = 'flex items-center justify-between px-2.5 pb-1.5 text-[11px] font-medium whitespace-nowrap text-slate-400'

function SideLink({ item, i, onNavigate }: { item: NavItem; i: number; onNavigate?: () => void }) {
  const { to, label, icon: ItemIcon, dot, active, count, countTone } = item
  const c = cascade(i)
  return (
    <li className={c.className} style={c.style}>
      <Link
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(LINK, 'font-medium', active ? 'bg-ink/[0.07] text-slate-950' : 'text-slate-600 hover:bg-ink/[0.04] hover:text-slate-950')}
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

function SectionLabel({ label, meta, i }: { label: string; meta?: ReactNode; i: number }) {
  const c = cascade(i)
  return (
    <p className={cn(LABEL, c.className)} style={c.style}>
      {label} {meta != null && <span className="ref">{meta}</span>}
    </p>
  )
}

/** A conversation the agent has open right now. */
function LiveRow({ t, i, onNavigate }: { t: Ticket; i: number; onNavigate?: () => void }) {
  const c = cascade(i)
  return (
    <li className={c.className} style={c.style}>
      <Link to={`/tickets?id=${t.id}`} onClick={onNavigate} className={cn(LINK, 'text-slate-600 hover:bg-ink/[0.04] hover:text-slate-950')}>
        <span className="relative flex size-1.5 shrink-0">
          {t.status === 'in_progress' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-500 opacity-70 motion-reduce:hidden" />}
          <span className={cn('relative inline-flex size-1.5 rounded-full', t.status === 'in_progress' ? 'bg-brand-500' : 'bg-slate-500')} />
        </span>
        <span className="truncate">{t.customer.name}</span>
        <span className="ref ml-auto text-[11px] text-slate-500">{t.id}</span>
      </Link>
    </li>
  )
}

/** A lead the agent scored hot. */
function HotRow({ l, i, onNavigate }: { l: Lead; i: number; onNavigate?: () => void }) {
  const c = cascade(i)
  return (
    <li className={c.className} style={c.style}>
      <Link to={`/leads?id=${l.id}`} onClick={onNavigate} className={cn(LINK, 'text-slate-600 hover:bg-ink/[0.04] hover:text-slate-950')}>
        <Flame className="size-3.5 shrink-0 text-amber-600" aria-hidden />
        <span className="truncate">{l.company || 'Untitled lead'}</span>
        <span className="ref ml-auto text-[11px] text-slate-500" aria-label={`score ${l.score}`}>{l.score}</span>
      </Link>
    </li>
  )
}

/** Aria's status and the share of queries the AI solved over the last two weeks. */
function AriaCard({ settings, i, onNavigate }: { settings: Settings | null; i: number; onNavigate?: () => void }) {
  const { stats } = useApp()
  if (!settings) return null
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const ai = stats ? sum(stats.daily.ai) : 0
  const all = stats ? ai + sum(stats.daily.human) : 0
  const c = cascade(i)
  return (
    <Link to="/settings" onClick={onNavigate} style={c.style} className={cn(c.className, 'mt-4 block rounded-xl border border-ink/[0.07] bg-surface p-3 transition-colors hover:border-ink/[0.12]')}>
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
  const { data: ch } = live.useChannels(10000, areaId === 'connect')
  const { data: co } = live.useConnectors(10000, areaId === 'connect')
  const connected = ch && co
    ? { channels: ch.channels.filter((c) => c.connected && c.enabled).length, apps: co.connectors.filter((c) => c.status === 'connected').length }
    : null

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
          // Everything sales in one place: the live numbers first, then the pipeline, then where leads come from.
          { label: 'Insights', items: [page('/sales/analytics')] },
          {
            label: 'Pipeline',
            items: [
              page('/leads', { label: 'All leads', active: stage === 'all', count: leads.length }),
              ...stages.map((s): NavItem => ({
                to: `/leads?stage=${encodeURIComponent(s)}`,
                label: stageLabel(s),
                dot: 'bg-slate-400',
                active: stage === s,
                count: leads.filter((l) => l.stage === s).length,
              })),
            ],
          },
          // Live from the demo API: campaign replies the leads agent turns into CRM leads.
          { label: 'Sources', items: [page('/calls'), page('/campaigns')] },
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
        groups: [{ items: [page('/'), page('/analytics'), page('/approvals', { count: pending, countTone: 'amber' })] }],
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

  const live = extra === 'live' ? tickets.filter((t) => t.status === 'open' || t.status === 'in_progress') : []
  const hot = extra === 'hot' ? leads.filter((l) => l.hot).sort((a, b) => b.score - a.score) : []

  // Number every row top to bottom, so they leave in that order when the panel narrows:
  // header, search, each group's label and links, the live list, then Aria's card.
  const head = 0
  const search = 1
  let n = 2
  const groupAt: { label: number; items: number[] }[] = []
  for (const g of groups) {
    const label = g.label ? n++ : -1
    const items: number[] = []
    for (let k = 0; k < g.items.length; k++) items.push(n++)
    groupAt.push({ label, items })
  }
  const list = live.length ? live : hot
  const listAt = list.length ? n++ : -1
  const rowsAt = list.map((_, k) => n + k)
  n += list.length
  const card = n++

  const sections = groups.map((g, gi) => (
    <div key={g.label ?? gi}>
      {g.label && <SectionLabel label={g.label} i={groupAt[gi]!.label} />}
      <ul className="space-y-px">
        {g.items.map((item, k) => <SideLink key={item.to} item={item} i={groupAt[gi]!.items[k]!} onNavigate={onNavigate} />)}
      </ul>
    </div>
  ))
  const liveList = live.length > 0 && (
    <div>
      <SectionLabel label="Live now" meta={live.length} i={listAt} />
      <ul className="space-y-px">{live.map((t, k) => <LiveRow key={t.id} t={t} i={rowsAt[k]!} onNavigate={onNavigate} />)}</ul>
    </div>
  )
  const hotList = hot.length > 0 && (
    <div>
      <SectionLabel label="Hot leads" meta={hot.length} i={listAt} />
      <ul className="space-y-px">{hot.map((l, k) => <HotRow key={l.id} l={l} i={rowsAt[k]!} onNavigate={onNavigate} />)}</ul>
    </div>
  )
  const h = cascade(head)
  const s = cascade(search)

  return (
    <div className="flex h-full w-full flex-col px-3 pt-3 pb-4" style={{ '--n': n } as CSSProperties}>
      <div className="flex items-start gap-2 px-1">
        <div key={area.id} className="min-w-0 flex-1 animate-rise py-1">
          <div className={h.className} style={h.style}>
            <h2 className="truncate text-[15px] leading-tight font-semibold tracking-[-0.01em] text-slate-950">{area.label}</h2>
            <p className="ref mt-1 truncate text-[11px] text-slate-500">{fact}</p>
          </div>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950"
            aria-label="Hide sidebar"
            title="Hide sidebar (⌘B)"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      <button
        onClick={onSearch}
        style={s.style}
        className={cn(s.className, 'mt-4 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] text-slate-500 transition-colors hover:bg-ink/[0.04] hover:text-slate-800')}
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search</span>
        <kbd className="font-mono text-[10px] text-slate-400">⌘K</kbd>
      </button>

      <nav key={area.id} className="scrollbar-thin mt-4 flex-1 animate-fade-in space-y-5 overflow-x-hidden overflow-y-auto" aria-label={area.label}>
        {sections}
        {liveList}
        {hotList}
      </nav>

      <AriaCard settings={settings} i={card} onNavigate={onNavigate} />
      <OwnerBlock i={card + 1} onNavigate={onNavigate} />
    </div>
  )
}

/** The signed-in person: the business owner. */
function OwnerBlock({ i, onNavigate }: { i: number; onNavigate?: () => void }) {
  const c = cascade(i)
  return (
    <Link to="/settings" onClick={onNavigate} style={c.style} className={cn(c.className, 'mt-2 flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-ink/[0.04]')} title={OWNER.email}>
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-human/15 text-[11px] font-semibold text-human" aria-hidden>{initials(OWNER.name)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-slate-950">{OWNER.name}</span>
        <span className="block truncate text-[11px] text-slate-500">{OWNER.role} · {OWNER.business}</span>
      </span>
    </Link>
  )
}
