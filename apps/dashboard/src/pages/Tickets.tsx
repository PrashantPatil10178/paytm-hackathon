import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, ExternalLink, ScrollText, UserRound, CheckCircle2, Clock, Hash, MessageSquareText, Gauge, CircleDot, LifeBuoy,
  ArrowUpRight, Ticket as TicketIcon,
} from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { useApp } from '../store'
import { PageHeader, Tabs, Select, LevelBadge, StatusBadge, SolvedBy, ChannelTag, Drawer, Button, EmptyState, SectionTitle } from '../components/ui'
import DataTable, { type Change, type Column } from '../components/DataTable'
import Trace from '../components/Trace'
import ToolChain from '../components/ToolChain'
import { api } from '../api'
import { CHANNELS, LEVELS, STATUSES, STATUS_ORDER } from '../meta'
import { ago, clock, cn, rupees } from '../lib'
import type { Level, Status, Ticket } from '../types'

const DESK = { zendesk: 'Zendesk', freshdesk: 'Freshdesk' } as const
const LEVEL_ORDER = Object.keys(LEVELS) as Level[]

const columns = (onOpen: (t: Ticket) => void): Column<Ticket>[] => [
  {
    key: 'id',
    header: 'Ticket',
    icon: Hash,
    className: 'whitespace-nowrap',
    sort: (t) => t.createdAt,
    render: (t) => (
      <span className="flex items-center gap-2">
        <span>
          <span className="ref block font-medium text-slate-900">{t.id}</span>
          <span className="block text-xs text-slate-500">{ago(t.createdAt)}</span>
        </span>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onOpen(t)}
          aria-label={`Open ${t.id}`}
          title="Open ticket"
          className="grid size-6 cursor-pointer place-items-center rounded-md text-slate-500 opacity-0 transition-opacity group-hover/r:opacity-100 hover:bg-ink/[0.06] hover:text-slate-950"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      </span>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    icon: UserRound,
    className: 'whitespace-nowrap',
    sort: (t) => t.customer.name.toLowerCase(),
    render: (t) => (
      <>
        <span className="flex items-center gap-2 font-medium text-slate-800">{t.customer.name}<ChannelTag channel={t.channel} compact /></span>
        <span className="block text-xs text-slate-500">{t.customer.city} · {CHANNELS[t.channel].label}</span>
      </>
    ),
  },
  {
    key: 'issue',
    header: 'Issue and agent path',
    icon: MessageSquareText,
    className: 'w-full max-w-0',
    render: (t) => (
      <>
        <span className="block truncate text-slate-800" title={t.issue}>{t.issue}</span>
        <ToolChain steps={t.steps} max={7} className="mt-1.5" live={t.status === 'open' || t.status === 'in_progress'} />
      </>
    ),
    edit: { type: 'text', get: (t) => t.issue, set: (_, v) => (v.trim() ? { issue: v.trim() } : null) },
  },
  {
    key: 'level',
    header: 'Level',
    icon: Gauge,
    sort: (t) => LEVEL_ORDER.indexOf(t.level),
    render: (t) => <LevelBadge level={t.level} />,
    edit: {
      type: 'select',
      options: LEVEL_ORDER.map((l) => ({ value: l, label: LEVELS[l].label })),
      renderOption: (l) => <LevelBadge level={l as Level} />,
      get: (t) => t.level,
      set: (_, v) => ({ level: v as Level }),
    },
  },
  {
    key: 'status',
    header: 'Status',
    icon: CircleDot,
    className: 'whitespace-nowrap',
    sort: (t) => STATUS_ORDER.indexOf(t.status),
    render: (t) => (
      <>
        <StatusBadge status={t.status} />
        {t.status === 'solved' && <span className="mt-1.5 block"><SolvedBy by={t.solvedBy} /></span>}
      </>
    ),
    edit: {
      type: 'select',
      options: STATUS_ORDER.map((s) => ({ value: s, label: STATUSES[s].label })),
      renderOption: (s) => <StatusBadge status={s as Status} />,
      get: (t) => t.status,
      // Solving a ticket by hand credits a human, unless the AI already solved it.
      set: (t, v) => ({ status: v as Status, solvedBy: v === 'solved' ? t.solvedBy ?? 'human' : t.solvedBy }),
    },
  },
  {
    key: 'helpdesk',
    header: 'Helpdesk',
    icon: LifeBuoy,
    className: 'whitespace-nowrap pr-5',
    sort: (t) => t.helpdeskId,
    render: (t) => (
      <>
        <span className="ref inline-flex items-center gap-1 text-xs font-medium text-slate-700">{t.helpdeskId}<ExternalLink className="size-3" aria-hidden /></span>
        <span className="block text-xs text-slate-500">{DESK[t.helpdesk]}</span>
      </>
    ),
  },
]

export default function Tickets() {
  const { tickets, setTickets, loading, toast } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [level, setLevel] = useState('all')
  const [channel, setChannel] = useState('all')
  const [q, setQ] = useState('')

  // Change one query param, keep the rest: the status view (?status=, also set from the sidebar)
  // and the open ticket (?id=) are independent.
  const patch = useCallback((key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value == null) next.delete(key)
      else next.set(key, value)
      return next
    }), [setParams])
  const raw = params.get('status')
  const status = STATUS_ORDER.includes(raw as Status) ? (raw as Status) : 'all'

  const matches = useCallback((t: Ticket) => {
    const s = q.trim().toLowerCase()
    return (level === 'all' || t.level === level) && (channel === 'all' || t.channel === channel) &&
      (!s || t.id.toLowerCase().includes(s) || t.customer.name.toLowerCase().includes(s) || t.issue.toLowerCase().includes(s))
  }, [q, level, channel])
  const filter = useCallback((t: Ticket) => matches(t) && (status === 'all' || t.status === status), [matches, status])
  const base = tickets.filter(matches)

  const open = useCallback((t: Ticket) => patch('id', t.id), [patch])
  const cols = useMemo(() => columns(open), [open])

  // Status changes sync back to the helpdesk, including undo and redo.
  const sync = (next: Ticket[], change: Change<Ticket>) => {
    setTickets(next)
    const moved = change.updates.filter((u) => u.after.status && u.after.status !== u.before.status)
    for (const u of moved) api.updateTicketStatus(u.id, u.after.status!)
    if (moved.length === 1) {
      const t = next.find((x) => x.id === moved[0]!.id)
      if (t) toast({ title: `${t.id} moved to ${STATUSES[t.status].label}`, desc: `Synced to ${DESK[t.helpdesk]} (${t.helpdeskId})` })
    } else if (moved.length > 1) {
      toast({ title: `${moved.length} tickets updated`, desc: 'Synced to Zendesk and Freshdesk' })
    }
  }

  const selected = tickets.find((t) => t.id === params.get('id'))

  return (
    <div>
      <PageHeader title="Tickets" description="Every ticket the AI created or touched, synced with your helpdesk. Edit a cell to change it there too." />

      <DataTable
        title="Helpdesk"
        icon={TicketIcon}
        meta={`${tickets.length} tickets`}
        label="Tickets"
        rows={tickets}
        getId={(t) => t.id}
        columns={cols}
        filter={filter}
        loading={loading}
        onRowsChange={sync}
        onOpen={open}
        openId={selected?.id}
        bulkActions={[{
          label: 'Mark solved',
          icon: CheckCircle2,
          apply: () => ({ patch: (t) => ({ status: 'solved' as Status, solvedBy: t.solvedBy ?? 'human' }) }),
        }]}
        toolbar={(
          <>
            <Tabs
              value={status}
              onChange={(s: string) => patch('status', s === 'all' ? null : s)}
              tabs={[{ value: 'all', label: 'All', count: base.length }, ...STATUS_ORDER.map((s) => ({ value: s, label: s === 'waiting' ? 'Waiting' : STATUSES[s].label, count: base.filter((t) => t.status === s).length }))]}
            />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tickets" placeholder="ID, customer or issue" className="h-8 w-56 rounded-full border border-ink/10 bg-ink/[0.03] pr-3 pl-9 text-[13px] outline-none placeholder:text-slate-400 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15" />
              </div>
              <Select label="Level" value={level} onChange={setLevel} options={[{ value: 'all', label: 'All levels' }, ...LEVEL_ORDER.map((v) => ({ value: v, label: LEVELS[v].label }))]} />
              <Select label="Channel" value={channel} onChange={setChannel} options={[{ value: 'all', label: 'All channels' }, ...Object.entries(CHANNELS).map(([v, c]) => ({ value: v, label: c.label }))]} />
            </div>
          </>
        )}
        empty={<EmptyState icon={TicketIcon} title="No tickets match" text="Try clearing a filter or searching by ticket ID." />}
      />

      <Drawer
        open={!!selected}
        onClose={() => patch('id', null)}
        width="max-w-2xl"
        title={selected && (
          <>
            <p className="text-xs font-medium text-slate-500"><span className="ref text-slate-700">{selected.id}</span> · opened {clock(selected.createdAt)}</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{selected.issue}</h2>
          </>
        )}
        subtitle={selected && (
          <div className="flex flex-wrap items-center gap-2">
            <LevelBadge level={selected.level} /><StatusBadge status={selected.status} /><ChannelTag channel={selected.channel} />
          </div>
        )}
      >
        {selected && <TicketDetail t={selected} onAudit={() => navigate(`/audit?ref=${selected.id}`)} />}
      </Drawer>
    </div>
  )
}

function TicketDetail({ t, onAudit }: { t: Ticket; onAudit: () => void }) {
  const solved = t.status === 'solved'
  return (
    <div className="space-y-6 p-6">
      <div className={cn('flex items-start gap-3 rounded-xl p-4 ring-1', solved ? 'bg-brand-50/70 ring-brand-100' : 'bg-amber-50/70 ring-amber-200')}>
        {solved ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-600" /> : <Clock className="mt-0.5 size-5 shrink-0 text-amber-600" />}
        <div>
          <p className="text-sm font-semibold text-slate-900">{solved ? `Resolved by ${t.solvedBy === 'ai' ? 'the AI' : 'a human'}` : 'In flight'}</p>
          <p className="mt-0.5 text-sm text-slate-700">{t.result}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <Field label="Customer" value={t.customer.name} />
        <Field label="Contact" value={t.customer.contact} />
        <Field label="City" value={t.customer.city} />
        <Field label="Amount" value={rupees(t.amount)} />
        <Field label="Solved by" value={<SolvedBy by={solved ? t.solvedBy : null} />} />
        <Field label="Helpdesk" value={<>{DESK[t.helpdesk]} · <span className="ref">{t.helpdeskId}</span></>} />
      </dl>

      <section>
        <SectionTitle>Conversation</SectionTitle>
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          {t.conversation.map((m, i) => {
            const mine = m.from !== 'customer'
            return (
              <div key={i} className={cn('flex gap-2', mine && 'flex-row-reverse')}>
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                  m.from === 'customer' ? 'bg-slate-200 text-slate-600' : m.from === 'ai' ? 'bg-brand-500 text-canvas' : 'bg-human text-canvas')}>
                  {m.from === 'customer' ? t.customer.name[0] : m.from === 'ai' ? <ResolveAIGlyph className="size-4" /> : <UserRound className="size-3.5" />}
                </span>
                <div className={cn('max-w-[78%] rounded-2xl px-3.5 py-2 text-sm', mine ? 'rounded-tr-sm bg-surface shadow-sm ring-1 ring-slate-200' : 'rounded-tl-sm bg-ink/[0.03] ring-1 ring-slate-200/70')}>
                  <p className="text-slate-800">{m.text}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{m.from === 'ai' ? 'Aria (AI)' : m.from === 'agent' ? 'Support agent' : t.customer.name} · {clock(m.time)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <SectionTitle action={<button onClick={onAudit} className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"><ScrollText className="size-3.5" aria-hidden />Open in audit log</button>}>
          What the agent did
        </SectionTitle>
        <ToolChain steps={t.steps} size="md" className="mb-5 flex-wrap gap-y-2" />
        <Trace steps={t.steps} />
      </section>

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <Button variant="primary" icon={ExternalLink}>Open in {DESK[t.helpdesk]}</Button>
        <Button onClick={onAudit} icon={ScrollText}>Full audit trail</Button>
      </div>
    </div>
  )
}

const Field = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
  </div>
)
