import { useState } from 'react'
import { Megaphone, Inbox, LoaderCircle, Flame, Ban, ArrowUpRight, CircleAlert } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { CAMPAIGN_CHANNELS, ENQUIRY_NEEDS, type CampaignResponse, type CampaignResponseStatus, type CampaignSummary, type LeadSyncResponse, type LeadSyncResult } from '@ph/shared'
import { api, live } from '../api'
import { useApp } from '../store'
import { Panel, PageHeader, Button, Skeleton, EmptyState, Tabs, type Tab } from '../components/ui'
import type { Icon } from '../meta'
import { ago, cn, num, rupees, HUBSPOT_URL } from '../lib'

// The HubSpot look-alike, where converted leads land (deal pages live at /deals/:id).

const channelLabel = (id: string) => CAMPAIGN_CHANNELS.find((c) => c.id === id)?.label ?? id
const needLabel = (id: string) => ENQUIRY_NEEDS.find((x) => x.id === id)?.label ?? id
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—')

/* ───────── Campaign table ───────── */

function CampaignTable({ campaigns }: { campaigns?: CampaignSummary[] }) {
  return (
    <Panel icon={Megaphone} title="Campaigns" meta={campaigns && `${campaigns.length} running or recent`}>
      {!campaigns ? <div className="p-4"><Skeleton className="h-32" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-ink/[0.06]">
                <th className="px-4 py-2.5 font-medium">Campaign</th>
                <th className="px-4 py-2.5 font-medium">Spend</th>
                <th className="px-4 py-2.5 text-right font-medium">Clicks</th>
                <th className="px-4 py-2.5 text-right font-medium">CTR</th>
                <th className="px-4 py-2.5 text-right font-medium">Responses</th>
                <th className="px-4 py-2.5 text-right font-medium">Leads</th>
                <th className="px-4 py-2.5 text-right font-medium">Cost / lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.05]">
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{c.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{channelLabel(c.channel)} · {c.status} · since <span className="ref">{new Date(c.started_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span></p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="ref text-slate-950">{rupees(c.spend)} <span className="text-slate-500">/ {rupees(c.budget)}</span></p>
                    <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden>
                      <div className="h-full rounded-full bg-slate-500" style={{ width: `${Math.min(100, (c.spend / c.budget) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="ref px-4 py-3 text-right text-slate-950">{num(c.clicks)}</td>
                  <td className="ref px-4 py-3 text-right text-slate-700">{pct(c.clicks, c.impressions)}</td>
                  <td className="ref px-4 py-3 text-right text-slate-950">{num(c.responses)}{c.new > 0 && <span className="block text-[11px] text-slate-500">{c.new} new</span>}</td>
                  <td className="ref px-4 py-3 text-right text-brand-700">{num(c.converted)}</td>
                  <td className="ref px-4 py-3 text-right text-slate-950">{c.converted ? rupees(Math.round(c.spend / c.converted)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/* ───────── Responses ───────── */

function StatusTag({ r }: { r: CampaignResponse }) {
  if (r.status === 'converted') {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-brand-200 ring-inset"><ResolveAIGlyph className="size-3" />Lead created</span>
  }
  if (r.status === 'skipped') {
    return <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink/[0.04] px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-ink/[0.08] ring-inset"><Ban className="size-3" />Skipped</span>
  }
  return <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-ink/10 ring-inset"><Inbox className="size-3" />New</span>
}

const DealLink = ({ id, short }: { id: number; short?: boolean }) => (
  <a href={`${HUBSPOT_URL}/deals/${id}`} target="_blank" rel="noreferrer" className="ref inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-slate-900 hover:underline">
    {short ? `#${id}` : <>Deal #{id}<ArrowUpRight className="size-3" aria-hidden /></>}
  </a>
)

function ResponseRow({ r }: { r: CampaignResponse }) {
  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-[13px]">
          <span className="font-medium text-slate-950">{r.name}</span>
          <span className="text-slate-500"> · {r.company || 'no company'}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="ref text-[11px] text-slate-500">{ago(r.created_at)}</span>
          <StatusTag r={r} />
        </div>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {r.campaign.name} · {channelLabel(r.campaign.channel)} · {needLabel(r.need)} · <span className="ref">{r.budget == null ? 'no budget given' : rupees(r.budget)}</span>{r.start_when && ` · ${r.start_when}`}
      </p>
      <p className="mt-2 line-clamp-2 text-[13px] text-pretty text-slate-700">“{r.message}”</p>
      {r.status !== 'new' && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600">
          <ResolveAIGlyph className="mt-px size-3.5 shrink-0 text-brand-600" aria-label="Aria" />
          <span className="min-w-0 flex-1">{r.note}</span>
          {r.deal_id && <DealLink id={r.deal_id} />}
        </p>
      )}
    </li>
  )
}

type View = CampaignResponseStatus | 'all'

function Responses({ campaigns }: { campaigns?: CampaignSummary[] }) {
  const [view, setView] = useState<View>('new')
  const { data, error } = live.useResponses(view === 'all' ? undefined : view)
  const list = data?.responses
  const count = (k: 'new' | 'converted' | 'skipped' | 'responses') => campaigns?.reduce((a, c) => a + c[k], 0)
  const tabs: Tab<View>[] = [
    { value: 'new', label: 'New', count: count('new') },
    { value: 'converted', label: 'Leads created', count: count('converted') },
    { value: 'skipped', label: 'Skipped', count: count('skipped') },
    { value: 'all', label: 'All', count: count('responses') },
  ]
  return (
    <Panel icon={Inbox} title="Responses" action={<Tabs tabs={tabs} value={view} onChange={setView} />}>
      {error ? (
        <p className="px-4 py-6 text-[13px] text-red-700">{error}</p>
      ) : !list ? (
        <div className="p-4"><Skeleton className="h-16" /><Skeleton className="mt-3 h-16" /></div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={view === 'new' ? 'Inbox zero' : 'Nothing here yet'}
          text={view === 'new' ? 'Every campaign response has been handled. New ones show up here as they arrive.' : 'Fetch new leads and Aria will work through the new responses.'}
        />
      ) : (
        <ul className="divide-y divide-ink/[0.06]">{list.map((r) => <ResponseRow key={r.id} r={r} />)}</ul>
      )}
    </Panel>
  )
}

/* ───────── Last run ───────── */

const OUTCOME: Record<LeadSyncResult['outcome'], { icon: Icon; tone: string }> = {
  converted: { icon: ResolveAIGlyph, tone: 'text-brand-600' },
  skipped: { icon: Ban, tone: 'text-slate-500' },
  failed: { icon: CircleAlert, tone: 'text-red-600' },
}

function LastRun({ run }: { run: LeadSyncResponse | null }) {
  if (!run) return null
  return (
    <Panel
      icon={ResolveAIGlyph}
      title="Last run"
      meta={`${run.processed} handled · ${run.converted} leads · ${run.skipped} skipped${run.failed ? ` · ${run.failed} failed` : ''}`}
      footer={<span>{run.remaining > 0 ? `${run.remaining} responses still waiting. Run again to continue.` : 'The queue is empty.'}</span>}
    >
      {run.results.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-slate-500">No new responses to work on.</p>
      ) : (
        <ul className="divide-y divide-ink/[0.06]">
          {run.results.map((x) => {
            const o = OUTCOME[x.outcome]
            return (
              <li key={x.response_id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                <o.icon className={cn('mt-0.5 size-3.5 shrink-0', o.tone)} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-950">{x.company || x.name}</span>
                  <span className="text-slate-500"> · {x.outcome === 'converted' ? `lead created${x.score ? `, ${x.score}` : ''}` : x.outcome}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{x.reason}</span>
                </span>
                {x.score === 'hot' && <span className="mt-0.5 shrink-0 text-amber-600" title="Hot lead"><Flame className="size-3.5" aria-hidden /></span>}
                {x.deal_id && <DealLink id={x.deal_id} short />}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* ───────── Page ───────── */

export default function Campaigns() {
  const { toast } = useApp()
  const { data, error, refresh } = live.useCampaigns()
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<LeadSyncResponse | null>(null)
  const campaigns = data?.campaigns
  const waiting = campaigns?.reduce((a, c) => a + c.new, 0) ?? 0

  async function fetchLeads() {
    setRunning(true)
    try {
      const res = await api.syncCampaignLeads(10)
      setRun(res)
      await refresh()
      toast({
        tone: res.converted ? 'success' : 'neutral',
        title: res.processed ? `${res.converted} new ${res.converted === 1 ? 'lead' : 'leads'} in HubSpot` : 'No new responses',
        desc: res.processed ? `${res.skipped} skipped${res.failed ? `, ${res.failed} failed` : ''}${res.remaining ? ` · ${res.remaining} still waiting` : ''}` : 'Every campaign response is already handled.',
      })
    } catch (err) {
      toast({ title: "Couldn't fetch leads", desc: (err as Error).message })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Replies to your Meta, Google, WhatsApp and email campaigns. Aria turns real enquiries into scored leads in HubSpot and sets spam and duplicates aside."
        actions={
          <Button variant="primary" icon={running ? LoaderCircle : ResolveAIGlyph} disabled={running} onClick={fetchLeads} className={running ? '[&>svg]:animate-spin' : undefined}>
            {running ? 'Working through responses…' : `Fetch new leads${waiting ? ` (${waiting})` : ''}`}
          </Button>
        }
      />
      {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>}
      <div className="space-y-3">
        <LastRun run={run} />
        <CampaignTable campaigns={campaigns} />
        <Responses campaigns={campaigns} />
      </div>
    </div>
  )
}
