import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, ExternalLink, ScrollText, Bot, UserRound, Ticket as TicketIcon, CheckCircle2, Clock } from 'lucide-react'
import { useApp } from '../store'
import {
  Card, PageHeader, Tabs, Select, LevelBadge, StatusBadge, SolvedBy, ChannelTag, Drawer, Button, EmptyState, Skeleton, SectionTitle,
} from '../components/ui'
import Trace from '../components/Trace'
import ToolChain from '../components/ToolChain'
import { CHANNELS, LEVELS, STATUSES, STATUS_ORDER } from '../meta'
import { ago, clock, cn, rupees } from '../lib'

const DESK = { zendesk: 'Zendesk', freshdesk: 'Freshdesk' }

export default function Tickets() {
  const { tickets, loading } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('all')
  const [level, setLevel] = useState('all')
  const [channel, setChannel] = useState('all')
  const [q, setQ] = useState('')

  const base = useMemo(() => {
    const s = q.trim().toLowerCase()
    return tickets.filter(
      (t) =>
        (level === 'all' || t.level === level) &&
        (channel === 'all' || t.channel === channel) &&
        (!s || t.id.toLowerCase().includes(s) || t.customer.name.toLowerCase().includes(s) || t.issue.toLowerCase().includes(s)),
    )
  }, [tickets, q, level, channel])
  const rows = status === 'all' ? base : base.filter((t) => t.status === status)

  const selected = tickets.find((t) => t.id === params.get('id'))
  const close = () => setParams({})

  return (
    <div>
      <PageHeader
        title="Tickets"
        description="Every ticket the AI created or touched, synced with your helpdesk."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Tabs
            value={status}
            onChange={setStatus}
            tabs={[{ value: 'all', label: 'All', count: base.length }, ...STATUS_ORDER.map((s) => ({ value: s, label: s === 'waiting' ? 'Waiting' : STATUSES[s].label, count: base.filter((t) => t.status === s).length }))]}
          />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tickets" placeholder="ID, customer or issue" className="h-9 w-56 rounded-lg border border-slate-200 bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15" />
            </div>
            <Select label="Level" value={level} onChange={setLevel} options={[{ value: 'all', label: 'All levels' }, ...Object.entries(LEVELS).map(([v, l]) => ({ value: v, label: l.label }))]} />
            <Select label="Channel" value={channel} onChange={setChannel} options={[{ value: 'all', label: 'All channels' }, ...Object.entries(CHANNELS).map(([v, c]) => ({ value: v, label: c.label }))]} />
          </div>
        </div>

        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                {['Ticket', 'Customer', 'Issue and agent path', 'Level', 'Status', 'Helpdesk'].map((h, i) => (
                  <th key={h} scope="col" className={cn('py-3 font-medium', i === 0 ? 'px-5' : 'px-3')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-5 py-3"><Skeleton className="h-8" /></td></tr>
              ))}
              {rows.map((t) => (
                <tr
                  key={t.id}
                  tabIndex={0}
                  onClick={() => setParams({ id: t.id })}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setParams({ id: t.id }))}
                  className={cn('cursor-pointer align-top transition-colors hover:bg-slate-50 focus-visible:bg-brand-50/50 focus-visible:outline-none', t.id === params.get('id') && 'bg-brand-50/50')}
                >
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <span className="ref font-medium text-slate-900">{t.id}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{ago(t.createdAt)}</span>
                  </td>
                  <td className="px-3 py-3.5 whitespace-nowrap">
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      {t.customer.name}
                      <span title={CHANNELS[t.channel].label}><ChannelTag channel={t.channel} compact /></span>
                    </span>
                    <span className="block text-xs text-slate-500">{t.customer.city} · {CHANNELS[t.channel].label}</span>
                  </td>
                  <td className="w-full max-w-0 px-3 py-3.5">
                    <span className="block truncate text-slate-800" title={t.issue}>{t.issue}</span>
                    <ToolChain steps={t.steps} max={7} className="mt-2" live={t.status === 'open' || t.status === 'in_progress'} />
                  </td>
                  <td className="px-3 py-3.5"><LevelBadge level={t.level} /></td>
                  <td className="px-3 py-3.5 whitespace-nowrap">
                    <StatusBadge status={t.status} />
                    {t.status === 'solved' && <span className="mt-1.5 block"><SolvedBy by={t.solvedBy} /></span>}
                  </td>
                  <td className="px-3 py-3.5 pr-5 whitespace-nowrap">
                    <a href="#" onClick={(e) => e.stopPropagation()} className="ref inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-brand-700" aria-label={`${t.helpdeskId} in ${DESK[t.helpdesk]}`}>
                      {t.helpdeskId}<ExternalLink className="size-3" aria-hidden />
                    </a>
                    <span className="block text-xs text-slate-500">{DESK[t.helpdesk]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <EmptyState icon={TicketIcon} title="No tickets match" text="Try clearing a filter or searching by ticket ID." />}
        </div>
      </Card>

      <Drawer
        open={!!selected}
        onClose={close}
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

function TicketDetail({ t, onAudit }) {
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
                  {m.from === 'customer' ? t.customer.name[0] : m.from === 'ai' ? <Bot className="size-3.5" /> : <UserRound className="size-3.5" />}
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

const Field = ({ label, value }) => (
  <div>
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
  </div>
)
