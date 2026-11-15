// Generative UI: the cards Aria draws inside the chat. The model only picks a card and an id or a
// filter; every card reads the live record from the store, so what it shows is always real and
// stays in sync (approve a request here and the Approvals page updates too).
// Props arrive partially while the tool call streams in, so every prop is optional.
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Frame, Loading, NotFound, OpenLink } from './frame'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Check, Flame, Hand, X } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { OWNER } from '@ph/shared'
import { useApp } from '../store'
import { useTheme } from '../theme'
import { Button, ChannelTag, LevelBadge, SolvedBy, StatusBadge } from '../components/ui'
import ToolChain from '../components/ToolChain'
import { CHART, LEVELS, STATUSES, channelMeta } from '../meta'
import { stageLabel } from '../nav'
import { cn, num, rupees, secondsLabel } from '../lib'

const MONO = '"Geist Mono Variable", ui-monospace, monospace'

/* ───────── Ticket ───────── */

export function TicketCard({ ticketId }) {
  const { tickets, loading } = useApp()
  if (!ticketId || loading) return <Loading title="Ticket" />
  const t = tickets.find((x) => x.id.toLowerCase() === ticketId.trim().toLowerCase())
  if (!t) return <NotFound title="Ticket">No ticket {ticketId} in this workspace.</NotFound>
  return (
    <Frame title={t.issue} meta={t.id} action={<OpenLink to={`/tickets?id=${t.id}`} />}>
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusBadge status={t.status} />
          <LevelBadge level={t.level} />
          <ChannelTag channel={t.channel} />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div className="min-w-0"><dt className="text-slate-500">Customer</dt><dd className="truncate text-slate-950">{t.customer.name}</dd></div>
          <div><dt className="text-slate-500">Amount</dt><dd className="ref text-slate-950">{rupees(t.amount)}</dd></div>
          <div><dt className="text-slate-500">Solved by</dt><dd><SolvedBy by={t.status === 'solved' ? t.solvedBy : null} /></dd></div>
        </dl>
        <ToolChain steps={t.steps} live={t.status === 'open' || t.status === 'in_progress'} labels />
        {t.result && <p className="rounded-lg bg-ink/[0.03] px-2.5 py-2 text-xs leading-relaxed text-slate-700">{t.result}</p>}
      </div>
    </Frame>
  )
}

/* ───────── Ticket list ───────── */

export function TicketListCard({ status, level, channel, solvedBy, limit }) {
  const { tickets, loading } = useApp()
  const rows = useMemo(
    () =>
      tickets
        .filter((t) => (!status || t.status === status) && (!level || t.level === level) && (!channel || t.channel === channel))
        .filter((t) => !solvedBy || (t.status === 'solved' && t.solvedBy === solvedBy))
        .slice(0, limit || 8),
    [tickets, status, level, channel, solvedBy, limit],
  )
  if (loading) return <Loading title="Tickets" />
  const filters = [STATUSES[status]?.label, LEVELS[level]?.label, channel && channelMeta(channel).label, solvedBy && `by ${solvedBy === 'ai' ? 'AI' : solvedBy === 'ai_approved' ? 'AI after approval' : 'human'}`].filter(Boolean)
  return (
    <Frame title={filters.length ? filters.join(' · ') : 'All tickets'} meta={rows.length} action={<OpenLink to="/tickets">Tickets</OpenLink>}>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-500">No tickets match.</p>
      ) : (
        <ul className="divide-y divide-ink/[0.06]">
          {rows.map((t) => <TicketRow key={t.id} t={t} />)}
        </ul>
      )}
    </Frame>
  )
}

function TicketRow({ t }) {
  const navigate = useNavigate()
  return (
    <li>
      <button onClick={() => navigate(`/tickets?id=${t.id}`)} className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-ink/[0.03]">
        <span className={cn('size-1.5 shrink-0 rounded-full', LEVELS[t.level].dot)} title={LEVELS[t.level].label} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-950">{t.issue}</span>
          <span className="block truncate text-[11px] text-slate-500"><span className="ref">{t.id}</span> · {t.customer.name}</span>
        </span>
        <StatusBadge status={t.status} />
      </button>
    </li>
  )
}

/* ───────── Approvals (human gate) ───────── */

export function ApprovalsCard({ approvalId }) {
  const { approvals, loading } = useApp()
  if (loading) return <Loading title="Waiting for you" />
  const pending = approvalId ? approvals.pending.filter((a) => a.id === approvalId || a.ref === approvalId) : approvals.pending
  const decided = approvalId ? approvals.history.filter((a) => a.id === approvalId || a.ref === approvalId).slice(0, 1) : []
  if (!pending.length && !decided.length) {
    return <NotFound title="Waiting for you">{approvalId ? `No approval request for ${approvalId}.` : 'Nothing is waiting for a human right now.'}</NotFound>
  }
  return (
    <Frame icon={Hand} title="Waiting for you" meta={pending.length || null} action={<OpenLink to="/approvals">Approvals</OpenLink>}>
      <ul className="divide-y divide-ink/[0.06]">
        {pending.map((a) => <ApprovalRow key={a.id} a={a} />)}
        {decided.map((a) => (
          <li key={a.id} className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-600">
            {a.decision === 'approved' ? <Check className="size-3.5 text-brand-600" /> : <X className="size-3.5 text-red-600" />}
            <span className="ref">{a.id}</span> {a.decision} by {!a.by || a.by === 'You' ? OWNER.name : a.by}
          </li>
        ))}
      </ul>
    </Frame>
  )
}

function ApprovalRow({ a }) {
  const { decideApproval } = useApp()
  return (
    <li className="space-y-2 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="truncate text-xs font-medium text-slate-950">{a.customer} <span className="ref font-normal text-slate-500">{a.ref}</span></p>
        {a.amount != null && <span className="ref shrink-0 text-xs text-slate-950">{rupees(a.amount)}</span>}
      </div>
      <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 ring-inset">{a.reason}</p>
      <p className="flex gap-2 text-xs leading-relaxed text-slate-700">
        <ResolveAIGlyph className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
        <span>{a.suggestion}{a.confidence != null && <span className="ref text-slate-500"> · {Math.round(a.confidence * 100)}% sure</span>}</span>
      </p>
      <div className="flex gap-2 pt-0.5">
        <Button size="sm" variant="primary" icon={Check} onClick={() => decideApproval(a.id, 'approved')}>Approve</Button>
        <Button size="sm" variant="ghost" icon={X} onClick={() => decideApproval(a.id, 'rejected', `Rejected by ${OWNER.first} from Ask Aria`)}>Reject</Button>
      </div>
    </li>
  )
}

/* ───────── Metrics ───────── */

export function MetricsCard() {
  const { resolved } = useTheme()
  const c = CHART[resolved]
  const { stats } = useApp()
  if (!stats) return <Loading title="Last 14 days" />
  const ai = stats.daily.ai.reduce((s, v) => s + v, 0)
  const human = stats.daily.human.reduce((s, v) => s + v, 0)
  const n = stats.daily.ai.length
  const days = stats.daily.ai.map((v, i) => ({ day: n - i, ai: v, human: stats.daily.human[i] ?? 0 }))
  const d = (v) => (Number.isFinite(v) ? v : 0)
  const kpis = [
    ['Queries', num(ai + human), d(stats.deltas.queries), '%'],
    ['Solved by AI', ai + human ? `${((ai / (ai + human)) * 100).toFixed(1)}%` : '—', d(stats.deltas.aiRate), ' pt'],
    ['Escalated', num(stats.escalated.value), d(stats.deltas.escalated), '%', true],
    ['Avg. solve', stats.solveTime.seconds > 0 ? secondsLabel(stats.solveTime.seconds) : '—', d(stats.deltas.solveTime), '%', true],
  ]
  return (
    <Frame title="Last 14 days" meta={`${num(ai + human)} queries`} action={<OpenLink to="/">Overview</OpenLink>}>
      <dl className="grid grid-cols-2 gap-px bg-ink/[0.06]">
        {kpis.map(([label, value, delta, unit, down]) => (
          <div key={label} className="bg-surface px-3 py-2.5">
            <dt className="text-[11px] text-slate-500">{label}</dt>
            <dd className="mt-0.5 flex items-baseline justify-between gap-2">
              <span className="ref text-[15px] font-medium text-slate-950">{value}</span>
              <span className={cn('ref text-[11px]', delta === 0 ? 'text-slate-500' : (down ? delta < 0 : delta > 0) ? 'text-brand-600' : 'text-red-600')}>
                {delta < 0 ? '−' : '+'}{Math.abs(delta)}{unit}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="h-28 border-t border-ink/[0.06] px-2 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} barCategoryGap="30%" margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: c.tick, fontSize: 10, fontFamily: MONO }} tickFormatter={(d) => (d === 1 ? 'today' : `${d}d`)} interval="preserveStartEnd" minTickGap={28} />
            <Tooltip
              cursor={{ fill: c.cursor }}
              contentStyle={{ background: c.surface, border: '1px solid rgb(128 128 128 / 0.2)', borderRadius: 8, fontSize: 11 }}
              labelFormatter={(d) => (d === 1 ? 'Today' : `${d} days ago`)}
            />
            <Bar dataKey="ai" name="AI" stackId="q" fill={c.ai} isAnimationActive={false} />
            <Bar dataKey="human" name="Human" stackId="q" fill={c.human} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="flex gap-4 border-t border-ink/[0.06] px-3 py-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: c.ai }} />AI <span className="ref text-slate-900">{num(ai)}</span></span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: c.human }} />Human <span className="ref text-slate-900">{num(human)}</span></span>
      </p>
    </Frame>
  )
}

/* ───────── Lead ───────── */

export function LeadCard({ leadId }) {
  const { leads, loading } = useApp()
  if (!leadId || loading) return <Loading title="Lead" />
  const l = leads.find((x) => x.id.toLowerCase() === leadId.trim().toLowerCase())
  if (!l) return <NotFound title="Lead">No lead {leadId} in this workspace.</NotFound>
  return (
    <Frame title={l.company || l.name || 'Lead'} meta={l.id} action={<OpenLink to={`/leads?id=${l.id}`}>Lead</OpenLink>}>
      <div className="space-y-3 p-3">
        <p className="text-xs leading-relaxed text-slate-700">{[l.name, l.need].filter(Boolean).join(' · ')}</p>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div><dt className="text-slate-500">Value</dt><dd className="ref text-slate-950">{rupees(l.value)}</dd></div>
          <div><dt className="text-slate-500">Stage</dt><dd className="text-slate-950">{stageLabel(l.stage)}</dd></div>
          <div>
            <dt className="text-slate-500">Score</dt>
            <dd className={cn('ref inline-flex items-center gap-1', l.hot ? 'text-amber-700' : 'text-slate-950')}>{l.hot && <Flame className="size-3" aria-hidden />}{l.score}</dd>
          </div>
        </dl>
        {l.steps.length > 0 && <ToolChain steps={l.steps} labels />}
      </div>
    </Frame>
  )
}
