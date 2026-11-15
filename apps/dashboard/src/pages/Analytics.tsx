import { useMemo, useState, type FormEvent } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  ChartColumnBig, CircleCheck, Eye, TriangleAlert, Table2, LoaderCircle, MessagesSquare, IndianRupee, Briefcase, Megaphone, Inbox,
} from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import type { AnalysisInsight, AnalysisReport, AnalyticsDataset, AnalyticsDatasetId, AnalyticsTotals, AnalyticsUnit, InsightTone } from '@ph/shared'
import { api, live } from '../api'
import { useApp } from '../store'
import { useTheme } from '../theme'
import { Panel, PageHeader, Button, Skeleton, EmptyState } from '../components/ui'
import { CHART, type Icon } from '../meta'
import { ago, cn, num, rupees } from '../lib'

type Palette = (typeof CHART)['light']
type Row = AnalyticsDataset['rows'][number]

const MONO = '"Geist Mono Variable", ui-monospace, monospace'
const compactInr = new Intl.NumberFormat('en-IN', { notation: 'compact', style: 'currency', currency: 'INR', maximumFractionDigits: 1, minimumFractionDigits: 0 })
const fmt = (unit: AnalyticsUnit, v: unknown) => (unit === 'inr' ? rupees(Number(v)) : num(Number(v)))
const axisFmt = (unit: AnalyticsUnit) => (v: number) => (unit === 'inr' ? compactInr.format(v) : num(v))
const n = (row: Row, key: string) => Number(row[key] ?? 0)

/* Tone of a finding. Never colour alone: every tone has an icon and a word. Neutral when it's working;
   amber and red keep their dashboard meanings (needs a look / act now). */
const TONES: Record<InsightTone, { label: string; icon: Icon; chip: string }> = {
  good: { label: 'Working', icon: CircleCheck, chip: 'bg-ink/[0.04] text-slate-700 ring-ink/[0.08]' },
  watch: { label: 'Watch', icon: Eye, chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  risk: { label: 'Act now', icon: TriangleAlert, chip: 'bg-red-50 text-red-700 ring-red-200' },
}

/** A chart header shows one chip: its most serious finding, with the number of findings when there are several. */
const worst = (findings: AnalysisInsight[]): InsightTone =>
  (['risk', 'watch', 'good'] as const).find((t) => findings.some((f) => f.tone === t)) ?? 'watch'

function ToneChip({ tone, count = 1 }: { tone: InsightTone; count?: number }) {
  const t = TONES[tone] ?? TONES.watch
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', t.chip)} title={count > 1 ? `${count} findings about this chart` : undefined}>
      <t.icon className="size-3" aria-hidden />{t.label}{count > 1 && <span className="ref opacity-70">·{count}</span>}
    </span>
  )
}

/* How each dataset is drawn. One y-axis per chart: a second measure goes in the tooltip, never a second scale.
   `color` names a CHART token; ai/human only where the series really is the AI or a person. */
interface View {
  series: { key: string; color: 'ai' | 'human' | 'bar' }[]
  extra?: string[]
  stacked?: boolean
  horizontal?: boolean
  /** Part-of-whole bars per campaign (leads vs other responses) */
  campaigns?: boolean
}
const VIEWS: Record<AnalyticsDatasetId, View> = {
  tickets_per_day: { series: [{ key: 'ai', color: 'ai' }, { key: 'human', color: 'human' }], stacked: true },
  orders_per_day: { series: [{ key: 'revenue', color: 'bar' }], extra: ['orders'] },
  deals_by_stage: { series: [{ key: 'value', color: 'bar' }], extra: ['deals'] },
  pipeline_by_score: { series: [{ key: 'value', color: 'bar' }], extra: ['deals'] },
  campaign_performance: { series: [{ key: 'leads', color: 'ai' }], campaigns: true },
  orders_by_status: { series: [{ key: 'orders', color: 'bar' }], extra: ['value'] },
  tickets_by_status: { series: [{ key: 'tickets', color: 'bar' }] },
  tickets_by_priority: { series: [{ key: 'tickets', color: 'bar' }] },
  contacts_by_source: { series: [{ key: 'contacts', color: 'bar' }], horizontal: true },
}
const ORDER = Object.keys(VIEWS) as AnalyticsDatasetId[]

/* ───────── Tooltip ───────── */

interface TipProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
  label?: string | number
  ds: AnalyticsDataset
  view: View
  c: Palette
}

function ChartTip({ active, payload, label, ds, view, c }: TipProps) {
  const row = payload?.[0]?.payload as Row | undefined
  if (!active || !row) return null
  const meta = (key: string) => ds.series.find((s) => s.key === key)
  const lines: [string, string | null][] = view.campaigns
    ? [['spend', null], ['clicks', null], ['responses', null], ['leads', c.ai]]
    : [...view.series.map((s): [string, string] => [s.key, c[s.color]]), ...(view.extra ?? []).map((k): [string, null] => [k, null])]
  return (
    <div className="min-w-44 rounded-lg border border-ink/10 bg-raised px-3 py-2.5 text-xs shadow-[0_16px_40px_-12px_rgb(0_0_0/0.35)]">
      <p className="ref mb-2 text-slate-500">{row.label ?? label}{row.channel ? ` · ${row.channel}` : ''}</p>
      {lines.map(([key, swatch]) => {
        const s = meta(key)
        if (!s) return null
        return (
          <p key={key} className="mt-1 flex items-center gap-2 text-slate-600 first:mt-0">
            {swatch ? <span className="size-2 rounded-sm" style={{ background: swatch }} /> : <span className="size-2" />}
            {s.label}
            <span className="ref ml-auto pl-4 text-slate-950">{fmt(s.unit, row[key])}</span>
          </p>
        )
      })}
      {view.campaigns && (
        <p className="mt-2 flex items-center gap-2 border-t border-ink/[0.06] pt-2 text-slate-600">
          <span className="size-2" />Cost per lead
          <span className="ref ml-auto pl-4 text-slate-950">{n(row, 'leads') ? rupees(Math.round(n(row, 'spend') / n(row, 'leads'))) : '—'}</span>
        </p>
      )}
    </div>
  )
}

/* ───────── One chart ───────── */

function DatasetChart({ ds, view, c }: { ds: AnalyticsDataset; view: View; c: Palette }) {
  const axis = { tickLine: false, axisLine: false, tick: { fill: c.tick, fontSize: 11, fontFamily: MONO } }
  const tip = (
    <Tooltip
      content={(p) => <ChartTip active={p.active} payload={p.payload} label={p.label as string | number | undefined} ds={ds} view={view} c={c} />}
      cursor={{ fill: c.cursor, radius: 4 }}
    />
  )

  if (view.campaigns) {
    // Part of a whole per campaign: responses that became leads (the AI's work, mint) and the rest (track).
    const rows = ds.rows.map((r) => ({ ...r, rest: Math.max(0, n(r, 'responses') - n(r, 'leads')) }))
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" barCategoryGap="30%" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={c.grid} />
          <XAxis type="number" allowDecimals={false} {...axis} />
          <YAxis type="category" dataKey="label" width={150} {...axis} />
          {tip}
          <Bar dataKey="leads" stackId="r" fill={c.ai} stroke={c.surface} strokeWidth={2} isAnimationActive={false} />
          <Bar dataKey="rest" stackId="r" fill={c.track} stroke={c.surface} strokeWidth={2} radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  const unit = ds.series.find((s) => s.key === view.series[0]!.key)?.unit ?? 'count'
  const last = view.series.length - 1
  if (view.horizontal) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={ds.rows} layout="vertical" barCategoryGap="30%" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke={c.grid} />
          <XAxis type="number" allowDecimals={false} tickFormatter={axisFmt(unit)} {...axis} />
          <YAxis type="category" dataKey="label" width={150} {...axis} />
          {tip}
          {view.series.map((s) => <Bar key={s.key} dataKey={s.key} fill={c[s.color]} radius={[0, 4, 4, 0]} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={ds.rows} barCategoryGap="30%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        {/* Days may thin out; categories never drop a label. */}
        <XAxis dataKey="label" interval={ds.id.endsWith('_per_day') ? 'preserveStartEnd' : 0} minTickGap={16} dy={6} {...axis} tick={{ ...axis.tick, fontSize: ds.rows.length > 4 ? 10 : 11 }} />
        <YAxis allowDecimals={false} width={unit === 'inr' ? 52 : 32} tickFormatter={axisFmt(unit)} {...axis} />
        {tip}
        {view.series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={view.stacked ? 'a' : undefined}
            fill={c[s.color]}
            stroke={view.stacked ? c.surface : undefined}
            strokeWidth={view.stacked ? 2 : 0}
            radius={!view.stacked || i === last ? [4, 4, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

function DataTable({ ds }: { ds: AnalyticsDataset }) {
  return (
    <div className="scrollbar-thin max-h-56 overflow-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-surface text-xs text-slate-500">
          <tr className="border-b border-ink/[0.06]">
            <th className="px-4 py-2 font-medium">{ds.id.endsWith('_per_day') ? 'Day' : 'Category'}</th>
            {ds.series.map((s) => <th key={s.key} className="px-4 py-2 text-right font-medium">{s.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/[0.05]">
          {ds.rows.map((r) => (
            <tr key={r.key}>
              <td className="px-4 py-1.5 text-slate-900">{r.label}</td>
              {ds.series.map((s) => <td key={s.key} className="ref px-4 py-1.5 text-right text-slate-950">{fmt(s.unit, r[s.key])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Legend({ view, ds, c }: { view: View; ds: AnalyticsDataset; c: Palette }) {
  const items: [string, string][] = view.campaigns
    ? [['Leads created by Aria', c.ai], ['Other responses', c.track]]
    : view.series.length > 1 ? view.series.map((s) => [ds.series.find((x) => x.key === s.key)?.label ?? s.key, c[s.color]]) : []
  if (!items.length) return null
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map(([label, color]) => <span key={label} className="flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: color }} />{label}</span>)}
    </span>
  )
}

function ChartPanel({ ds, c, findings }: { ds: AnalyticsDataset; c: Palette; findings: AnalysisInsight[] }) {
  const [table, setTable] = useState(false)
  const view = VIEWS[ds.id]
  return (
    <Panel
      id={`chart-${ds.id}`}
      icon={ChartColumnBig}
      title={ds.title}
      meta={summary(ds)}
      className={cn('scroll-mt-20', findings.length > 0 && 'ring-1 ring-ink/[0.08]')}
      action={
        <div className="flex items-center gap-1.5">
          {findings.length > 0 && <ToneChip tone={worst(findings)} count={findings.length} />}
          <Button variant="ghost" size="sm" icon={table ? ChartColumnBig : Table2} onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? 'Chart' : 'Table'}
          </Button>
        </div>
      }
      footer={<><Legend view={view} ds={ds} c={c} /><span className="truncate text-right" title={ds.description}>{ds.description}</span></>}
    >
      {table ? <DataTable ds={ds} /> : <div className="h-56 px-2 pt-3 pb-2"><DatasetChart ds={ds} view={view} c={c} /></div>}
    </Panel>
  )
}

/** The figure shown next to a chart's title: the total of its main series. */
function summary(ds: AnalyticsDataset): string | null {
  const view = VIEWS[ds.id]
  const main = ds.series.find((s) => s.key === view.series[0]!.key)
  if (!main) return null
  const sumOf = (key: string) => ds.rows.reduce((a, r) => a + n(r, key), 0)
  if (ds.id === 'tickets_per_day') return `${num(sumOf('ai') + sumOf('human'))} · 14d`
  if (ds.id === 'orders_per_day') return `${rupees(sumOf('revenue'))} · 14d`
  if (view.campaigns) return `${num(sumOf('leads'))} leads · ${num(sumOf('responses'))} responses`
  return fmt(main.unit, sumOf(main.key))
}

/* ───────── Aria's report ───────── */

function Report({ report, loading, running, titles }: { report: AnalysisReport | null; loading: boolean; running: boolean; titles: Partial<Record<AnalyticsDatasetId, string>> }) {
  if (loading) return <Panel icon={ResolveAIGlyph} title="Aria's findings"><div className="p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="mt-4 h-14" /><Skeleton className="mt-2 h-14" /></div></Panel>
  if (!report) {
    return (
      <Panel icon={ResolveAIGlyph} title="Aria's findings">
        <EmptyState icon={ResolveAIGlyph} title={running ? 'Aria is reading the numbers…' : 'No analysis yet'} text="Run an analysis and Aria reads every chart below, then writes what stands out and what to do about it." />
      </Panel>
    )
  }
  const jump = (id: AnalyticsDatasetId) => document.getElementById(`chart-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <Panel
      icon={ResolveAIGlyph}
      title="Aria's findings"
      meta={`${ago(report.created_at)} · ${report.author === 'Rules' ? 'rule-based stand-in' : report.author}`}
      footer={
        <>
          <span>Written against the numbers at <span className="ref">{new Date(report.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>; the charts below are live.</span>
          {report.author === 'Rules' && <span className="shrink-0">Start the agent (<span className="ref">bun run dev:agent</span>) for Aria</span>}
        </>
      }
    >
      <div className="border-b border-ink/[0.06] px-4 py-3.5">
        <p className="text-[15px] leading-snug font-medium text-pretty text-slate-950">{report.headline}</p>
      </div>
      <ul className="divide-y divide-ink/[0.06]">
        {report.insights.map((f, i) => (
          <li key={i}>
            <button onClick={() => jump(f.dataset)} className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ink/[0.025]">
              <ToneChip tone={f.tone} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-slate-950">{f.title}</span>
                <span className="mt-0.5 block text-[13px] text-pretty text-slate-600">{f.finding}</span>
              </span>
              <span className="ref hidden shrink-0 pt-0.5 text-[11px] text-slate-500 sm:block">{titles[f.dataset] ?? ''} ↓</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/* ───────── KPI strip ───────── */

function Tile({ icon: TileIcon, label, value, note }: { icon: Icon; label: string; value: string; note: string }) {
  return (
    <div className="bg-surface p-4 last:col-span-2 md:last:col-span-1">
      <p className="flex items-center gap-1.5 text-[13px] text-slate-500"><TileIcon className="size-3.5" aria-hidden />{label}</p>
      <p className="figure mt-3 text-[26px] leading-none font-semibold whitespace-nowrap text-slate-950">{value}</p>
      <p className="mt-2.5 truncate text-xs text-slate-500">{note}</p>
    </div>
  )
}

function Totals({ t }: { t?: AnalyticsTotals }) {
  return (
    <Panel icon={Inbox} title="Right now" meta="live from Postgres">
      <div className="grid grid-cols-2 gap-px bg-ink/[0.07] md:grid-cols-5">
        {t ? (
          <>
            <Tile icon={ResolveAIGlyph} label="Handled by AI" value={`${t.ai_rate.toFixed(1)}%`} note={`${num(t.tickets_ai)} of ${num(t.tickets)} tickets · ${t.tickets_escalated} escalated`} />
            <Tile icon={MessagesSquare} label="Open tickets" value={num(t.tickets_open)} note={`${num(t.tickets_solved)} solved`} />
            <Tile icon={IndianRupee} label="Revenue, 14 days" value={rupees(t.revenue_14d)} note={`${num(t.orders_14d)} orders · ${t.refunds} refunds`} />
            <Tile icon={Briefcase} label="Open pipeline" value={rupees(t.pipeline_open)} note={`${t.deals_open} deals · ${t.hot_open} hot`} />
            <Tile icon={Megaphone} label="Campaign leads" value={num(t.campaign_leads)} note={t.cost_per_lead ? `${rupees(t.cost_per_lead)} per lead` : `${num(t.campaign_responses)} responses so far`} />
          </>
        ) : Array.from({ length: 5 }).map((_, i) => <div key={i} className="bg-surface p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-4 h-7 w-20" /><Skeleton className="mt-3 h-3 w-28" /></div>)}
      </div>
    </Panel>
  )
}

/* ───────── Page ───────── */

export default function Analytics() {
  const { toast } = useApp()
  const { resolved } = useTheme()
  const c = CHART[resolved]
  const metrics = live.useMetrics()
  const latest = live.useLatestReport()
  const [focus, setFocus] = useState('')
  const [running, setRunning] = useState(false)

  const report = latest.data?.report ?? null
  const byDataset = useMemo(() => {
    const m: Partial<Record<AnalyticsDatasetId, AnalysisInsight[]>> = {}
    for (const f of report?.insights ?? []) (m[f.dataset] ??= []).push(f)
    return m
  }, [report])
  const datasets = useMemo(() => {
    const list = metrics.data?.datasets ?? []
    return ORDER.map((id) => list.find((d) => d.id === id)).filter((d): d is AnalyticsDataset => Boolean(d))
  }, [metrics.data])
  const titles = useMemo(() => Object.fromEntries(datasets.map((d) => [d.id, d.title])) as Partial<Record<AnalyticsDatasetId, string>>, [datasets])

  async function run(e: FormEvent) {
    e.preventDefault()
    setRunning(true)
    try {
      const { report: r } = await api.runAnalysis(focus.trim())
      await latest.refresh()
      toast({ tone: 'success', title: 'Analysis published', desc: `${r.insights.length} findings · ${r.author === 'Rules' ? 'rule-based stand-in' : 'by Aria'}` })
    } catch (err) {
      toast({ title: "Analysis didn't finish", desc: (err as Error).message })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Live numbers from the helpdesk, the shop, the CRM and your campaigns. Aria reads them and writes what stands out."
        actions={
          <form onSubmit={run} className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <input
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              maxLength={300}
              placeholder="Ask about something specific (optional)"
              aria-label="Question for the analysis"
              className="h-8 w-full min-w-0 rounded-full border border-ink/10 bg-ink/[0.03] px-3.5 text-[13px] text-slate-900 placeholder:text-slate-400 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none sm:w-72"
            />
            <Button type="submit" variant="primary" icon={running ? LoaderCircle : ResolveAIGlyph} disabled={running} className={running ? '[&>svg]:animate-spin' : undefined}>
              {running ? 'Analysing…' : 'Run analysis'}
            </Button>
          </form>
        }
      />

      {metrics.error && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{metrics.error}</p>
      )}

      <div className="space-y-3">
        <Report report={report} loading={!latest.data && !latest.error} running={running} titles={titles} />
        <Totals t={metrics.data?.totals} />
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          {datasets.length
            ? datasets.map((ds) => <ChartPanel key={ds.id} ds={ds} c={c} findings={byDataset[ds.id] ?? []} />)
            : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
        </div>
      </div>
    </div>
  )
}
