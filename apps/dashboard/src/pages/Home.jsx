import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  MessagesSquare, Sparkles, CornerUpRight, Timer, Flame, Activity, ChartColumn, History, Gauge,
  Radio, ArrowUpRight, ShieldCheck, Coffee, CalendarRange,
} from 'lucide-react'
import { api } from '../api'
import { useApp, useAuditLog } from '../store'
import { useTheme } from '../theme'
import { Panel, Skeleton, Button, StatusBadge, ChannelTag } from '../components/ui'
import ToolChain from '../components/ToolChain'
import { CHANNELS, LEVELS, RESULTS } from '../meta'
import { ago, cn, duration, num, rupees } from '../lib'

// Chart colours mirror the tokens in index.css (SVG attributes can't read CSS vars).
const CHART = {
  light: { ai: '#12a46e', human: '#5160d6', line: '#18181b', grid: '#ededef', tick: '#71717a', surface: '#ffffff', cursor: 'rgb(9 9 11 / 0.04)' },
  dark: { ai: '#3ecf8e', human: '#8b93f8', line: '#ededf0', grid: '#232327', tick: '#7a7a84', surface: '#161618', cursor: 'rgb(255 255 255 / 0.04)' },
}
const MONO = '"Geist Mono Variable", ui-monospace, monospace'

const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`)

const AllLink = ({ to, children = 'All' }) => (
  <Link to={to} className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-ink/[0.05] hover:text-slate-950">
    {children}<ArrowUpRight className="size-3.5" aria-hidden />
  </Link>
)

const Row = 'transition-colors hover:bg-ink/[0.025] focus-visible:-outline-offset-2'

/* ───────── KPI strip ───────── */

/** Vertical-bar sparkline. Every bar keeps at least 2px so zero days still read as days. */
function SparkBars({ values }) {
  const max = Math.max(...values, 1)
  return (
    <div className="flex h-8 w-full max-w-[82px] min-w-0 items-end justify-end gap-[2px]" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className={cn('max-w-[3px] min-w-px flex-1 rounded-[1px]', i === values.length - 1 ? 'bg-slate-950' : 'bg-slate-300')}
          style={{ height: `${Math.max(2, (v / max) * 32)}px` }}
        />
      ))}
    </div>
  )
}

/** A figure with its unit set small, e.g. 82.4% or 1m 52s. */
const Figure = ({ parts }) => (
  <p className="figure text-[28px] leading-none font-semibold whitespace-nowrap text-slate-950">
    {parts.map(([n, unit], i) => (
      <span key={i}>{n}{unit && <span className="mr-1 ml-0.5 text-sm font-medium tracking-normal text-slate-500 last:mr-0">{unit}</span>}</span>
    ))}
  </p>
)

function Kpi({ icon: Icon, label, parts, delta, unit = '%', goodWhenDown, spark }) {
  const good = goodWhenDown ? delta < 0 : delta > 0
  return (
    <div className="bg-surface p-4 last:col-span-2 md:last:col-span-1">
      <p className="flex items-center gap-1.5 text-[13px] text-slate-500"><Icon className="size-3.5" aria-hidden />{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="shrink-0"><Figure parts={parts} /></div>
        <SparkBars values={spark} />
      </div>
      <p className="mt-3 text-xs">
        <span className={cn('ref font-medium', good ? 'text-brand-600' : 'text-red-600')}>{signed(delta)}{unit}</span>
        <span className="text-slate-500"> vs prior 14 days</span>
      </p>
    </div>
  )
}

/* ───────── Approvals callout ───────── */

const TONE_DOT = { red: 'bg-red-500', amber: 'bg-amber-500', indigo: 'bg-human' }

function ApprovalsCallout({ pending }) {
  const navigate = useNavigate()
  if (!pending.length) {
    return (
      <Panel icon={ShieldCheck} title="Approvals" meta="0">
        <p className="px-4 py-4 text-[13px] text-slate-500">No approvals waiting. <span className="text-slate-700">Aria is inside its limits.</span></p>
      </Panel>
    )
  }
  const refunds = pending.filter((p) => p.kind === 'ticket').reduce((s, p) => s + (p.amount || 0), 0)
  const deals = pending.filter((p) => p.kind === 'lead')
  const dealValue = deals.reduce((s, p) => s + (p.amount || 0), 0)
  const what = [
    refunds > 0 && `${rupees(refunds)} in refunds`,
    deals.length === 1 && `a ${rupees(dealValue)} deal`,
    deals.length > 1 && `${deals.length} deals worth ${rupees(dealValue)}`,
  ].filter(Boolean)
  const plural = what.length > 1 || deals.length > 1 || (refunds > 0 && what.length === 1)
  const urgent = pending.find((p) => p.tone === 'red') ?? pending[0]
  const openUrgent = () => navigate(urgent.kind === 'ticket' ? `/tickets?id=${urgent.ref}` : `/audit?ref=${urgent.ref}`)

  return (
    <section aria-label="Waiting for approval" className="rounded-2xl border border-amber-200 bg-amber-50 p-1">
      <div className="px-3 pt-2.5 pb-3">
        <p className="flex items-center gap-2 text-[11px] font-medium text-amber-700">
          <span className="size-1.5 rounded-full bg-warn" /> {pending.length} waiting for you
        </p>
        <h2 className="mt-1.5 text-[15px] leading-snug font-medium text-pretty text-slate-950">
          {what.length ? `${what.join(' and ')} ${plural ? 'are' : 'is'} waiting on your approval` : 'Actions are waiting on your approval'}
        </h2>
      </div>
      <ul className="divide-y divide-ink/[0.06] overflow-hidden rounded-xl border border-ink/[0.06] bg-surface">
        {pending.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
            <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[p.tone] ?? 'bg-amber-500')} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-slate-900">{p.customer.split(' · ')[0]}</span>
              <span className="text-slate-500"> · {p.reason}</span>
            </span>
            <span className="ref shrink-0 text-slate-900">{rupees(p.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 px-2 pt-2.5 pb-1.5">
        <Button variant="primary" size="sm" onClick={() => navigate('/approvals')}>Review {pending.length}</Button>
        <Button size="sm" onClick={openUrgent}>Open <span className="ref">{urgent.ref}</span></Button>
      </div>
    </section>
  )
}

/* ───────── Working now ───────── */

function WorkingNow({ tickets, agent }) {
  const navigate = useNavigate()
  const live = tickets
    .filter((t) => t.status === 'open' || t.status === 'in_progress')
    .sort((a, b) => new Date(b.steps.at(-1).time) - new Date(a.steps.at(-1).time))

  return (
    <Panel
      icon={Activity}
      title="Working now"
      meta={live.length}
      action={<AllLink to="/tickets">All tickets</AllLink>}
      footer={live.length > 0 && <><span>Each row is the path {agent} took through your tools</span><span className="ref">live</span></>}
    >
      {live.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-10 text-sm text-slate-500">
          <Coffee className="size-5 text-slate-400" aria-hidden /> Nothing open. New messages show up here the moment {agent} picks them up.
        </div>
      ) : (
        <ul className="divide-y divide-ink/[0.06]">
          {live.map((t) => {
            const first = t.steps[0]
            const now = t.steps.at(-1)
            return (
              <li key={t.id}>
                <button onClick={() => navigate(`/tickets?id=${t.id}`)} className={cn('block w-full cursor-pointer px-4 py-4 text-left', Row)}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span className="ref text-slate-700">{t.id}</span>
                        <span aria-hidden>·</span>
                        <span>{t.customer.name}</span>
                        <ChannelTag channel={t.channel} compact />
                        <StatusBadge status={t.status} />
                      </p>
                      <p className="mt-1.5 truncate text-[15px] font-medium text-slate-950">{t.issue}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="ref text-xs text-slate-700">{duration(first.time, now.time)}</p>
                      <p className="ref mt-1 text-[11px] text-slate-500">{t.steps.length} steps</p>
                    </div>
                  </div>
                  <div className="mt-3.5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                    <div className="max-w-full overflow-x-auto pb-0.5 [scrollbar-width:none]">
                      <ToolChain steps={t.steps} size="md" labels live animate />
                    </div>
                    <p className="text-xs text-slate-500">
                      Now <span className="text-slate-800">{now.step}</span> in {now.tool} · <span className="ref">{ago(now.time)}</span>
                    </p>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* ───────── Queries per day ───────── */

function ChartTooltip({ active, payload, label, c }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="min-w-44 rounded-lg border border-ink/10 bg-raised px-3 py-2.5 text-xs shadow-[0_16px_40px_-12px_rgb(0_0_0/0.35)]">
      <p className="ref mb-2 text-slate-500">{label}</p>
      <p className="flex items-center gap-2 text-slate-600"><span className="size-2 rounded-sm" style={{ background: c.ai }} />Solved by AI <span className="ref ml-auto pl-4 text-slate-950">{d.ai}</span></p>
      <p className="mt-1 flex items-center gap-2 text-slate-600"><span className="size-2 rounded-sm" style={{ background: c.human }} />Human <span className="ref ml-auto pl-4 text-slate-950">{d.human}</span></p>
      <p className="mt-2 flex items-center gap-2 border-t border-ink/[0.06] pt-2 text-slate-600"><span className="h-px w-2 bg-slate-950" />Automated <span className="ref ml-auto pl-4 text-slate-950">{d.rate.toFixed(0)}%</span></p>
    </div>
  )
}

function QueriesChart({ derived }) {
  const { resolved } = useTheme()
  const c = CHART[resolved]
  const first = derived?.daily[0].rate
  const last = derived?.daily.at(-1).rate
  return (
    <Panel
      icon={ChartColumn}
      title="Queries per day"
      meta={derived && `${num(derived.total)} · 14d`}
      footer={
        derived && (
          <>
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: c.ai }} />AI <span className="ref text-slate-900">{num(derived.aiTotal)}</span></span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: c.human }} />Human <span className="ref text-slate-900">{num(derived.humanTotal)}</span></span>
              <span className="flex items-center gap-1.5"><span className="h-px w-3 bg-slate-950" />Automated</span>
            </span>
            <span className="ref text-slate-900">{first.toFixed(0)}% → {last.toFixed(0)}%</span>
          </>
        )
      }
    >
      <div className="h-60 px-2 pt-4 pb-2">
        {derived ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={derived.daily} barCategoryGap="38%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: c.tick, fontSize: 11, fontFamily: MONO }} interval="preserveStartEnd" minTickGap={24} dy={6} />
              {/* Bars fill the lower ~70% so the automation line rides above them. */}
              <YAxis yAxisId="q" tickLine={false} axisLine={false} tick={{ fill: c.tick, fontSize: 11, fontFamily: MONO }} width={32} domain={[0, derived.yTop]} ticks={derived.yTicks} />
              <YAxis yAxisId="rate" orientation="right" hide domain={[0, 100]} />
              <Tooltip content={<ChartTooltip c={c} />} cursor={{ fill: c.cursor, radius: 4 }} />
              <Bar yAxisId="q" dataKey="ai" stackId="q" fill={c.ai} stroke={c.surface} strokeWidth={1} isAnimationActive={false} />
              <Bar yAxisId="q" dataKey="human" stackId="q" fill={c.human} stroke={c.surface} strokeWidth={1} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="rate" dataKey="rate" type="monotone" stroke={c.line} strokeWidth={1.25} dot={false} activeDot={{ r: 3, fill: c.line, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <Skeleton className="m-2 h-52" />}
      </div>
    </Panel>
  )
}

/* ───────── Recent activity ───────── */

const RESULT_DOT = { success: 'bg-slate-400', escalated: 'bg-amber-500', blocked: 'bg-red-500' }

function RecentActivity({ audit }) {
  const navigate = useNavigate()
  return (
    <Panel icon={History} title="Recent activity" meta="newest first" action={<AllLink to="/audit">Audit log</AllLink>}>
      <ul className="divide-y divide-ink/[0.06]">
        {audit.slice(0, 7).map((a) => (
          <li key={a.key}>
            <button onClick={() => navigate(`/audit?ref=${a.ref}`)} className={cn('flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left', Row)}>
              <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', RESULT_DOT[a.result])} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px]">
                  <span className="truncate">
                    <span className="font-medium text-slate-950">{a.step}</span>
                    <span className="text-slate-500"> in {a.tool}</span>
                  </span>
                  {a.result !== 'success' && (
                    <span className={cn('shrink-0 text-xs font-medium', a.result === 'blocked' ? 'text-red-600' : 'text-amber-600')}>{RESULTS[a.result].label}</span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  <span className="ref text-slate-700">{a.ref}</span> · {a.who} · {a.detail}
                </p>
              </div>
              <span className="ref shrink-0 pt-px text-[11px] text-slate-500">{ago(a.time)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* ───────── Side column ───────── */

function HotLeads({ leads }) {
  const hot = leads.filter((l) => l.hot)
  return (
    <Panel icon={Flame} title="Hot leads" meta={hot.length} action={<AllLink to="/audit">Audit</AllLink>}>
      {hot.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-slate-500">No hot leads yet today.</p>
      ) : (
        <ul className="divide-y divide-ink/[0.06]">
          {hot.map((l) => (
            <li key={l.id}>
              <Link to={`/audit?ref=${l.id}`} className={cn('block px-4 py-3', Row)}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13px] font-medium text-slate-950">{l.company}</p>
                  <span className="ref shrink-0 text-[13px] text-slate-950">{rupees(l.value)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{l.name} · {l.need}</p>
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <ToolChain steps={l.steps} />
                  <span className="ref inline-flex shrink-0 items-center gap-1 text-xs text-amber-700">
                    <Flame className="size-3" aria-hidden />{l.score}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Bar fill per severity: neutral until it matters. */
const LEVEL_BAR = { low: 'bg-slate-300', medium: 'bg-slate-500', high: 'bg-amber-500', critical: 'bg-red-500' }
const LEVEL_CODE = { low: 'low', medium: 'med', high: 'high', critical: 'crit' }

function MeterRow({ code, codeClass, label, count, total, bar, onClick }) {
  const pct = (count / total) * 100
  return (
    <button onClick={onClick} className={cn('grid w-full cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)_4.5rem_4.75rem] items-center gap-3 px-4 py-2.5 text-left text-[13px]', Row)}>
      <span className={cn('ref text-xs', codeClass ?? 'text-slate-500')}>{code}</span>
      <span className="truncate text-slate-900">{label}</span>
      <span className="h-1 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
        <span className={cn('block h-full rounded-full', bar)} style={{ width: `${pct}%` }} />
      </span>
      <span className="ref text-right text-slate-950">{num(count)} <span className="text-[11px] text-slate-500">{pct.toFixed(0)}%</span></span>
    </button>
  )
}

function ByLevel({ stats, total }) {
  const navigate = useNavigate()
  const critical = stats?.byLevel.find((l) => l.level === 'critical')
  return (
    <Panel
      icon={Gauge}
      title="Tickets by level"
      meta="set on intake"
      footer={critical && <span><span className="ref font-medium text-red-600">{critical.count}</span> critical. Every one went to a human within 2 minutes.</span>}
    >
      {stats ? (
        <div className="py-1.5">
          {stats.byLevel.map((l) => (
            <MeterRow
              key={l.level}
              code={LEVEL_CODE[l.level]}
              codeClass={l.level === 'critical' ? 'text-red-600' : undefined}
              label={LEVELS[l.level].label}
              count={l.count}
              total={total}
              bar={LEVEL_BAR[l.level]}
              onClick={() => navigate('/tickets')}
            />
          ))}
        </div>
      ) : <Skeleton className="m-4 h-36" />}
    </Panel>
  )
}

function ByChannel({ stats, total }) {
  const navigate = useNavigate()
  return (
    <Panel icon={Radio} title="Queries by channel" meta={stats && `${stats.byChannel.length} channels`}>
      {stats ? (
        <div className="py-1.5">
          {stats.byChannel.map((c) => {
            const ch = CHANNELS[c.channel]
            return (
              <MeterRow
                key={c.channel}
                code={<ch.icon className="size-3.5 text-slate-500" aria-hidden />}
                label={ch.label}
                count={c.count}
                total={total}
                bar="bg-brand-500"
                onClick={() => navigate('/channels')}
              />
            )
          })}
        </div>
      ) : <Skeleton className="m-4 h-32" />}
    </Panel>
  )
}

/* ───────── Page ───────── */

const fmtDay = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

export default function Home() {
  const [stats, setStats] = useState(null)
  const { approvals, settings, leads, tickets, loading } = useApp()
  const audit = useAuditLog()
  const agent = settings?.agentName || 'the agent'

  useEffect(() => { api.getStats().then(setStats) }, [])

  const derived = useMemo(() => {
    if (!stats) return null
    const today = new Date()
    const daily = stats.daily.ai.map((ai, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() - (13 - i))
      const human = stats.daily.human[i]
      return { label: fmtDay(d), ai, human, rate: (ai / (ai + human)) * 100 }
    })
    const aiTotal = stats.daily.ai.reduce((a, b) => a + b, 0)
    const humanTotal = stats.daily.human.reduce((a, b) => a + b, 0)
    const total = aiTotal + humanTotal
    // Even ticks, with ~40% headroom so the automation line rides above the bars.
    const yTop = Math.ceil((Math.max(...daily.map((d) => d.ai + d.human)) * 1.4) / 50) * 50
    return {
      yTop, yTicks: Array.from({ length: yTop / 50 + 1 }, (_, i) => i * 50),
      daily, aiTotal, humanTotal, total,
      aiPct: (aiTotal / total) * 100,
      spark: daily.map((d) => d.ai + d.human),
      aiSpark: daily.map((d) => d.rate),
      range: `${daily[0].label} – ${daily.at(-1).label}`,
    }
  }, [stats])

  const pending = approvals.pending
  const solve = stats?.solveTime.seconds

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl leading-tight font-semibold tracking-[-0.02em] text-slate-950">Overview</h1>
          <p className="ref mt-1.5 text-xs text-slate-500">ShopKart · how {agent} handled support and sales</p>
        </div>
        <Link to="/audit" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 text-[13px] font-medium text-slate-800 transition-colors hover:border-ink/15 hover:bg-ink/[0.07] hover:text-slate-950">
          Audit log <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      <Panel icon={CalendarRange} title="Last 14 days" meta={derived?.range}>
        <div className="grid grid-cols-2 gap-px bg-ink/[0.07] md:grid-cols-5" aria-label="Last 14 days">
          {derived ? (
            <>
              <Kpi icon={MessagesSquare} label="Queries handled" parts={[[num(derived.total)]]} delta={stats.deltas.queries} spark={derived.spark} />
              <Kpi icon={Sparkles} label="Solved by AI" parts={[[derived.aiPct.toFixed(1), '%']]} delta={stats.deltas.aiRate} unit=" pt" spark={derived.aiSpark} />
              <Kpi icon={CornerUpRight} label="Escalated to humans" parts={[[stats.escalated.value]]} delta={stats.deltas.escalated} goodWhenDown spark={stats.escalated.spark} />
              <Kpi icon={Timer} label="Avg. solve time" parts={[[Math.floor(solve / 60), 'm'], [String(Math.round(solve % 60)).padStart(2, '0'), 's']]} delta={stats.deltas.solveTime} goodWhenDown spark={stats.solveTime.spark} />
              <Kpi icon={Flame} label="Hot leads" parts={[[stats.hotLeads.value]]} delta={stats.deltas.hotLeads} spark={stats.hotLeads.spark} />
            </>
          ) : (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-surface p-4 last:col-span-2 md:last:col-span-1"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-7 w-20" /><Skeleton className="mt-4 h-3 w-28" /></div>
            ))
          )}
        </div>
      </Panel>

      {/* On small screens the approvals callout comes straight after the numbers. */}
      <div className="mt-3 lg:hidden">{!loading && <ApprovalsCallout pending={pending} />}</div>

      <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {loading ? (
            <Panel icon={Activity} title="Working now"><div className="p-4"><Skeleton className="h-20" /><Skeleton className="mt-3 h-20" /><Skeleton className="mt-3 h-20" /></div></Panel>
          ) : (
            <WorkingNow tickets={tickets} agent={agent} />
          )}
          <QueriesChart derived={derived} />
          <RecentActivity audit={audit} />
        </div>

        <div className="space-y-3">
          <div className="hidden lg:block">
            {loading ? <Skeleton className="h-64 rounded-2xl" /> : <ApprovalsCallout pending={pending} />}
          </div>
          {loading ? <Skeleton className="h-48 rounded-2xl" /> : <HotLeads leads={leads} />}
          <ByLevel stats={stats} total={derived?.total} />
          <ByChannel stats={stats} total={derived?.total} />
        </div>
      </div>
    </div>
  )
}
