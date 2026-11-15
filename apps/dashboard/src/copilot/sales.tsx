// Ask Aria's sales tools: everything the Sales area can do, available from the chat.
// Cards follow the same rule as cards.jsx: the model passes only an id or a filter, and the card reads
// the live record from the demo API, so it can't show invented data. The two actions run the real
// agents (leads, sales analysis) exactly like the buttons in the Sales area.
import { useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'
import { Briefcase, Ban, CircleAlert, Flame, Inbox, LoaderCircle, Megaphone, ChartPie, ArrowUpRight } from 'lucide-react'
import { useAgentContext, useFrontendTool } from '@copilotkit/react-core/v2'
import { ResolveAIGlyph } from '@ph/shared/brand'
import {
  CAMPAIGN_CHANNELS, DEAL_STAGES, SALES_DATASETS,
  type AnalysisReport, type AnalyticsDatasetId, type CampaignResponseStatus, type DealStage, type LeadScore, type LeadSyncResponse,
} from '@ph/shared'
import { api, live } from '../api'
import { useTheme } from '../theme'
import { CHART } from '../meta'
import { ago, cn, num, rupees, HUBSPOT_URL } from '../lib'
import { DatasetMiniChart, ToneChip } from '../pages/Analytics'
import { Frame, Loading, NotFound, OpenLink } from './frame'

const STAGE_IDS = DEAL_STAGES.map((s) => s.id) as [DealStage, ...DealStage[]]
const stageLabel = (id: string) => DEAL_STAGES.find((s) => s.id === id)?.label ?? id
const channelLabel = (id: string) => CAMPAIGN_CHANNELS.find((c) => c.id === id)?.label ?? id
const OPEN = (stage: DealStage) => stage !== 'closed_won' && stage !== 'closed_lost'

/** What the two action tools produced, by tool call id, so their card can show the real outcome. */
const runs = new Map<string, { leads?: LeadSyncResponse; report?: AnalysisReport; error?: string }>()

const HotMark = ({ score }: { score: LeadScore }) =>
  score === 'hot' ? <span className="inline-flex items-center gap-0.5 text-amber-700"><Flame className="size-3" aria-hidden />hot</span> : <span className="text-slate-500">{score}</span>

const HubSpotLink = ({ id }: { id: number }) => (
  <a href={`${HUBSPOT_URL}/deals/${id}`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-ink/[0.06] hover:text-slate-950">
    HubSpot<ArrowUpRight className="size-3" aria-hidden />
  </a>
)

/* ───────── Cards ───────── */

export function DealsCard({ stage, score, limit }: { stage?: DealStage; score?: LeadScore; limit?: number }) {
  const { data } = live.useDeals()
  if (!data) return <Loading title="Pipeline" />
  const rows = data.deals.filter((d) => (stage ? d.stage === stage : OPEN(d.stage)) && (!score || d.score === score))
  const shown = rows.slice(0, limit || 8)
  const title = [stage ? stageLabel(stage) : 'Open deals', score && `${score} only`].filter(Boolean).join(' · ')
  return (
    <Frame icon={Briefcase} title={title} meta={`${rows.length} · ${rupees(rows.reduce((a, d) => a + d.amount, 0))}`} action={<OpenLink to="/sales/analytics">Sales</OpenLink>}>
      {shown.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">No deals match.</p> : (
        <ul className="divide-y divide-ink/[0.06]">
          {shown.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-950">{d.name}</span>
                <span className="block truncate text-[11px] text-slate-500"><span className="ref">#{d.id}</span> · {d.contact.name} · {stageLabel(d.stage)} · <HotMark score={d.score} /></span>
              </span>
              <span className="ref shrink-0 text-slate-950">{rupees(d.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

export function DealCard({ dealId }: { dealId?: number }) {
  const { data, error } = live.useDeal(dealId ?? null)
  if (dealId == null || (!data && !error)) return <Loading title="Deal" />
  if (!data) return <NotFound title="Deal">No deal #{dealId} in the CRM.</NotFound>
  return (
    <Frame icon={Briefcase} title={data.name} meta={`#${data.id}`} action={<HubSpotLink id={data.id} />}>
      <div className="space-y-3 p-3">
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div><dt className="text-slate-500">Value</dt><dd className="ref text-slate-950">{rupees(data.amount)}</dd></div>
          <div><dt className="text-slate-500">Stage</dt><dd className="text-slate-950">{stageLabel(data.stage)}</dd></div>
          <div><dt className="text-slate-500">Score</dt><dd className="ref"><HotMark score={data.score} /></dd></div>
        </dl>
        <p className="text-xs text-slate-600">{data.contact.name} · {data.contact.company} · {data.contact.source}{data.next_step && <> · next: <span className="text-slate-900">{data.next_step}</span></>}</p>
        {data.meeting && <p className="text-xs text-slate-600">Call booked: <span className="ref text-slate-900">{new Date(data.meeting.start).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></p>}
        <ul className="space-y-1.5 border-t border-ink/[0.06] pt-2.5">
          {data.activities.slice(0, 4).map((a) => (
            <li key={a.id} className="flex gap-2 text-[11px] leading-relaxed text-slate-600">
              {a.ai ? <ResolveAIGlyph className="mt-0.5 size-3 shrink-0 text-brand-600" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-human" />}
              <span className="min-w-0 flex-1 line-clamp-2">{a.body}</span>
              <span className="ref shrink-0 text-slate-400">{ago(a.created_at)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  )
}

export function CampaignsCard() {
  const { data } = live.useCampaigns()
  if (!data) return <Loading title="Campaigns" />
  return (
    <Frame icon={Megaphone} title="Campaigns" meta={`${data.campaigns.reduce((a, c) => a + c.converted, 0)} leads`} action={<OpenLink to="/campaigns">Campaigns</OpenLink>}>
      <ul className="divide-y divide-ink/[0.06]">
        {data.campaigns.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-slate-950">{c.name}</span>
              <span className="block truncate text-[11px] text-slate-500">{channelLabel(c.channel)} · {rupees(c.spend)} spent · {c.responses} responses{c.new ? ` · ${c.new} new` : ''}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="ref block text-brand-700">{c.converted} leads</span>
              <span className="ref block text-[11px] text-slate-500">{c.converted ? `${rupees(Math.round(c.spend / c.converted))}/lead` : '—'}</span>
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

export function ResponsesCard({ status, limit }: { status?: CampaignResponseStatus; limit?: number }) {
  const { data } = live.useResponses(status)
  if (!data) return <Loading title="Campaign responses" />
  const rows = data.responses.slice(0, limit || 6)
  const title = status === 'converted' ? 'Became leads' : status === 'skipped' ? 'Skipped responses' : status === 'new' ? 'Waiting for Aria' : 'Campaign responses'
  return (
    <Frame icon={Inbox} title={title} meta={data.responses.length} action={<OpenLink to="/campaigns">Campaigns</OpenLink>}>
      {rows.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">{status === 'new' ? 'Nothing waiting: every response has been handled.' : 'None yet.'}</p> : (
        <ul className="divide-y divide-ink/[0.06]">
          {rows.map((r) => (
            <li key={r.id} className="px-3 py-2 text-xs">
              <p className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-slate-950">{r.name} <span className="font-normal text-slate-500">· {r.company || 'no company'}</span></span>
                <span className="ref shrink-0 text-slate-950">{r.budget == null ? '—' : rupees(r.budget)}</span>
              </p>
              <p className="truncate text-[11px] text-slate-500">{r.campaign.name} · {r.status === 'new' ? `“${r.message}”` : r.note}</p>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}

export function SalesAnalyticsCard({ dataset }: { dataset?: AnalyticsDatasetId }) {
  const { resolved } = useTheme()
  const c = CHART[resolved]
  const metrics = live.useMetrics()
  const latest = live.useLatestReport('sales')
  if (!metrics.data) return <Loading title="Sales analytics" />
  const t = metrics.data.totals
  const id = dataset && SALES_DATASETS.includes(dataset) ? dataset : 'deals_by_stage'
  const ds = metrics.data.datasets.find((d) => d.id === id)
  const report = latest.data?.report
  const kpis: [string, string][] = [
    ['Open pipeline', rupees(t.pipeline_open)],
    ['Hot deals', num(t.hot_open)],
    ['Closed won', rupees(t.won_value)],
    ['Campaign leads', `${num(t.campaign_leads)}${t.cost_per_lead ? ` · ${rupees(t.cost_per_lead)}/lead` : ''}`],
  ]
  return (
    <Frame icon={ChartPie} title="Sales analytics" meta="live" action={<OpenLink to="/sales/analytics">Open</OpenLink>}>
      <dl className="grid grid-cols-2 gap-px bg-ink/[0.06]">
        {kpis.map(([label, value]) => (
          <div key={label} className="bg-surface px-3 py-2"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="ref mt-0.5 text-[13px] font-medium text-slate-950">{value}</dd></div>
        ))}
      </dl>
      {ds && (
        <div className="border-t border-ink/[0.06]">
          <p className="px-3 pt-2 text-[11px] text-slate-500">{ds.title}</p>
          <div className="h-36 px-1 pb-1"><DatasetMiniChart ds={ds} c={c} /></div>
        </div>
      )}
      {report && (
        <div className="border-t border-ink/[0.06] px-3 py-2">
          <p className="flex gap-1.5 text-xs leading-relaxed text-slate-700"><ResolveAIGlyph className="mt-0.5 size-3.5 shrink-0 text-brand-600" />{report.headline}</p>
          <p className="ref mt-1 text-[11px] text-slate-400">latest sales report · {ago(report.created_at)}</p>
        </div>
      )}
    </Frame>
  )
}

/* Action cards: "working" while the agent runs, then the real outcome. */

function Working({ title, children }: { title: string; children: string }) {
  return (
    <Frame icon={ResolveAIGlyph} title={title}>
      <p className="flex items-center gap-2 px-3 py-3 text-xs text-slate-600"><LoaderCircle className="size-3.5 animate-spin text-brand-600" aria-hidden />{children}</p>
    </Frame>
  )
}

function LeadRunCard({ toolCallId, status, result }: { toolCallId: string; status: string; result?: unknown }) {
  if (status !== 'complete') return <Working title="Fetching campaign leads">Aria is working through new campaign responses…</Working>
  const run = runs.get(toolCallId)
  if (!run?.leads) return <NotFound title="Fetching campaign leads">{run?.error ?? String(result ?? 'Done.')}</NotFound>
  const r = run.leads
  const icon = { converted: ResolveAIGlyph, skipped: Ban, failed: CircleAlert }
  return (
    <Frame icon={ResolveAIGlyph} title="Campaign leads" meta={`${r.converted} new · ${r.skipped} skipped${r.failed ? ` · ${r.failed} failed` : ''}`} action={<OpenLink to="/campaigns">Campaigns</OpenLink>}>
      {r.results.length === 0 ? <p className="px-3 py-3 text-xs text-slate-500">No new responses to work on.</p> : (
        <ul className="divide-y divide-ink/[0.06]">
          {r.results.map((x) => {
            const Icon = icon[x.outcome]
            return (
              <li key={x.response_id} className="flex items-start gap-2 px-3 py-2 text-xs">
                <Icon className={cn('mt-0.5 size-3.5 shrink-0', x.outcome === 'converted' ? 'text-brand-600' : x.outcome === 'failed' ? 'text-red-600' : 'text-slate-500')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-950">{x.company || x.name}</span>
                  <span className="text-slate-500"> · {x.outcome === 'converted' ? `lead #${x.deal_id}${x.score ? `, ${x.score}` : ''}` : x.outcome}</span>
                  <span className="block truncate text-[11px] text-slate-500">{x.reason}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Frame>
  )
}

function AnalysisRunCard({ toolCallId, status, result }: { toolCallId: string; status: string; result?: unknown }) {
  if (status !== 'complete') return <Working title="Sales analysis">Aria is reading the pipeline and campaigns…</Working>
  const run = runs.get(toolCallId)
  if (!run?.report) return <NotFound title="Sales analysis">{run?.error ?? String(result ?? 'Done.')}</NotFound>
  const r = run.report
  return (
    <Frame icon={ChartPie} title="Sales analysis" meta={ago(r.created_at)} action={<OpenLink to="/sales/analytics">Open</OpenLink>}>
      <p className="border-b border-ink/[0.06] px-3 py-2.5 text-xs font-medium leading-relaxed text-slate-950">{r.headline}</p>
      <ul className="divide-y divide-ink/[0.06]">
        {r.insights.map((f, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
            <ToneChip tone={f.tone} />
            <span className="min-w-0 flex-1"><span className="block font-medium text-slate-950">{f.title}</span><span className="block text-[11px] leading-relaxed text-slate-600">{f.finding}</span></span>
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/* ───────── Registration ───────── */

/** Registers the sales tools and shares live sales data with the model. Mounted inside the CopilotKit provider. */
export default function SalesTools() {
  const deals = live.useDeals()
  const campaigns = live.useCampaigns()
  const metrics = live.useMetrics()
  const report = live.useLatestReport('sales')

  // Handlers run later; read the latest data through a ref so each tool registers once.
  const latest = useRef({ deals: deals.data, campaigns: campaigns.data, metrics: metrics.data })
  useEffect(() => { latest.current = { deals: deals.data, campaigns: campaigns.data, metrics: metrics.data } })

  const context = useMemo(() => {
    const t = metrics.data?.totals
    return {
      crmDeals: (deals.data?.deals ?? []).map((d) => ({
        id: d.id, name: d.name, company: d.contact.company, contact: d.contact.name, amount: d.amount, stage: d.stage, score: d.score, nextStep: d.next_step,
        meeting: d.meeting?.start ?? null,
      })),
      campaigns: (campaigns.data?.campaigns ?? []).map((c) => ({
        name: c.name, channel: c.channel, status: c.status, spend: c.spend, budget: c.budget, clicks: c.clicks, responses: c.responses,
        waiting: c.new, leads: c.converted, skipped: c.skipped,
      })),
      salesTotals: t ? {
        pipelineOpen: t.pipeline_open, dealsOpen: t.deals_open, hotOpen: t.hot_open, wonValue: t.won_value,
        campaignSpend: t.campaign_spend, campaignResponses: t.campaign_responses, campaignLeads: t.campaign_leads, costPerLead: t.cost_per_lead,
      } : null,
      latestSalesReport: report.data?.report ? { headline: report.data.report.headline, at: report.data.report.created_at, findings: report.data.report.insights.map((i) => `${i.tone}: ${i.title}`) } : null,
    }
  }, [deals.data, campaigns.data, metrics.data, report.data])
  useAgentContext({ description: 'Live sales data from the CRM and marketing campaigns (Postgres): deals, campaigns, sales totals and the latest sales report', value: context })

  useFrontendTool({
    name: 'show_deals',
    description:
      'Show live CRM deals (the real HubSpot pipeline) as one card. Without a stage it shows all open deals, so "hot deals" is just ' +
      'score "hot" with no stage. Call it once per question; never once per stage.',
    parameters: z.object({
      stage: z.enum(STAGE_IDS).optional().describe('new_lead, qualified, meeting_booked, quote_sent, closed_won, closed_lost'),
      score: z.enum(['hot', 'warm', 'cold']).optional(),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    handler: async (f) => {
      const all = latest.current.deals?.deals ?? []
      const rows = all.filter((d) => (f.stage ? d.stage === f.stage : OPEN(d.stage)) && (!f.score || d.score === f.score))
      return `Card shown: ${rows.length} deals worth ${rupees(rows.reduce((a, d) => a + d.amount, 0))}.`
    },
    render: ({ args }) => <DealsCard {...args} />,
  })

  useFrontendTool({
    name: 'show_deal',
    description: 'Show one live CRM deal by its number (e.g. 13): value, stage, score, contact, next step, booked call and recent activity.',
    parameters: z.object({ dealId: z.number().int().positive().describe('CRM deal number, e.g. 13') }),
    handler: async ({ dealId }) => {
      const d = latest.current.deals?.deals.find((x) => x.id === dealId)
      return d ? `Card shown for deal #${d.id} (${d.name}, ${stageLabel(d.stage)}, ${d.score}).` : `No deal #${dealId}. Tell the user it does not exist.`
    },
    render: ({ args }) => <DealCard {...args} />,
  })

  useFrontendTool({
    name: 'show_campaigns',
    description: 'Show the marketing campaigns (Meta, Google, WhatsApp, email) with spend, responses, leads created and cost per lead.',
    parameters: z.object({}),
    handler: async () => {
      const cs = latest.current.campaigns?.campaigns ?? []
      return `Card shown: ${cs.length} campaigns, ${cs.reduce((a, c) => a + c.converted, 0)} leads, ${cs.reduce((a, c) => a + c.new, 0)} responses waiting.`
    },
    render: () => <CampaignsCard />,
  })

  useFrontendTool({
    name: 'show_campaign_responses',
    description: 'Show people who answered a campaign: waiting for Aria (new), turned into leads (converted) or skipped (spam, duplicates).',
    parameters: z.object({ status: z.enum(['new', 'converted', 'skipped']).optional(), limit: z.number().int().min(1).max(10).optional() }),
    handler: async ({ status }) => `Card shown${status ? ` with ${status} responses` : ''}.`,
    render: ({ args }) => <ResponsesCard {...args} />,
  })

  useFrontendTool({
    name: 'show_sales_analytics',
    description: 'Show the live sales KPIs (open pipeline, hot deals, won, campaign leads and cost per lead), one sales chart and the latest sales report headline.',
    parameters: z.object({ dataset: z.enum(SALES_DATASETS as [AnalyticsDatasetId, ...AnalyticsDatasetId[]]).optional().describe('The chart to draw; default deals_by_stage') }),
    handler: async () => {
      const t = latest.current.metrics?.totals
      return t ? `Card shown. Open pipeline ${rupees(t.pipeline_open)} in ${t.deals_open} deals (${t.hot_open} hot); won ${rupees(t.won_value)}; campaigns ${rupees(t.campaign_spend)} spent, ${t.campaign_leads} leads${t.cost_per_lead ? `, ${rupees(t.cost_per_lead)} per lead` : ''}.` : 'Card shown.'
    },
    render: ({ args }) => <SalesAnalyticsCard {...args} />,
  })

  useFrontendTool({
    name: 'fetch_campaign_leads',
    description:
      'Run the leads agent: it works through new campaign responses and creates scored CRM leads, skipping spam and people already in the pipeline. ' +
      'This creates real records. Use only when the user asks to fetch, process or import leads.',
    parameters: z.object({ limit: z.number().int().min(1).max(25).optional().describe('Most responses to process, default 10') }),
    handler: async ({ limit }, ctx) => {
      if (ctx?.isReplay) return 'Not run again after a reload.'
      const id = ctx?.toolCall.id ?? ''
      try {
        const r = await api.syncCampaignLeads(limit ?? 10)
        runs.set(id, { leads: r })
        return `Done: ${r.processed} responses handled, ${r.converted} leads created (${r.results.filter((x) => x.score === 'hot').length} hot), ${r.skipped} skipped, ${r.failed} failed, ${r.remaining} still waiting. ` +
          r.results.map((x) => `${x.company || x.name}: ${x.outcome}${x.deal_id ? ` deal #${x.deal_id}` : ''} (${x.reason})`).join('; ')
      } catch (e) {
        runs.set(id, { error: (e as Error).message })
        return `Failed: ${(e as Error).message}`
      }
    },
    render: (p) => <LeadRunCard toolCallId={p.toolCallId} status={p.status} result={p.result} />,
  })

  useFrontendTool({
    name: 'run_sales_analysis',
    description:
      'Run a fresh sales analysis with the analysis agent (pipeline, lead scores, campaigns, lead sources) and show its findings. ' +
      'Takes about half a minute. Use when the user wants new insights or advice, not to look up a number (the context already has those).',
    parameters: z.object({ focus: z.string().max(300).optional().describe('A question to focus on, e.g. "Which campaign should get more budget?"') }),
    handler: async ({ focus }, ctx) => {
      if (ctx?.isReplay) return 'Not run again after a reload.'
      const id = ctx?.toolCall.id ?? ''
      try {
        const { report: r } = await api.runAnalysis(focus, 'sales')
        runs.set(id, { report: r })
        return `Published: ${r.headline} Findings: ${r.insights.map((i) => `[${i.tone}] ${i.title}: ${i.finding}`).join(' | ')}`
      } catch (e) {
        runs.set(id, { error: (e as Error).message })
        return `Failed: ${(e as Error).message}`
      }
    },
    render: (p) => <AnalysisRunCard toolCallId={p.toolCallId} status={p.status} result={p.result} />,
  })

  return null
}
