import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Search, Flame, ScrollText, Users, Hand, Building2, UserRound, MessageSquareText, Gauge, Columns3, IndianRupee, Clock,
  PenLine, Trash2, ArrowUpRight,
} from 'lucide-react'
import { useApp } from '../store'
import { PageHeader, Tabs, Drawer, Button, Badge, EmptyState, ChannelTag } from '../components/ui'
import DataTable, { type Column } from '../components/DataTable'
import Trace from '../components/Trace'
import ToolChain from '../components/ToolChain'
import { LEAD_STAGES, byStage } from '../nav'
import { ago, cn, duration, rupees } from '../lib'
import type { Lead } from '../types'

const STAGE_BADGE = 'bg-slate-100 text-slate-700 ring-slate-200'
const StageBadge = ({ stage }: { stage: string }) => <Badge className={STAGE_BADGE}>{stage}</Badge>

function Source({ lead }: { lead: Lead }) {
  if (lead.channel !== 'manual') return <ChannelTag channel={lead.channel} compact />
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-ink/[0.04] text-slate-700 ring-1 ring-ink/[0.08] ring-inset" title="Added by hand">
      <PenLine className="size-3.5" aria-label="Added by hand" />
    </span>
  )
}

const nextId = (leads: Lead[]) => `L-${Math.max(300, ...leads.map((l) => Number(l.id.replace(/\D/g, '')) || 0)) + 1}`

/** Opens the lead's drawer. Shown on row hover, and always on the open row. */
function OpenButton({ lead, onOpen }: { lead: Lead; onOpen: (l: Lead) => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => onOpen(lead)}
      aria-label={`Open ${lead.company || lead.id}`}
      title="Open lead"
      className="ml-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-slate-500 opacity-0 transition-opacity group-hover/r:opacity-100 hover:bg-ink/[0.06] hover:text-slate-950 focus-visible:opacity-100"
    >
      <ArrowUpRight className="size-3.5" />
    </button>
  )
}

const columns = (onOpen: (l: Lead) => void): Column<Lead>[] => [
  {
    key: 'company',
    header: 'Company',
    icon: Building2,
    className: 'min-w-52',
    sort: (l) => l.company.toLowerCase(),
    render: (l) => (
      <span className="flex items-center gap-2.5">
        <Source lead={l} />
        <span className={cn('truncate font-medium', l.company ? 'text-slate-900' : 'text-slate-400')}>{l.company || 'Untitled'}</span>
        <OpenButton lead={l} onOpen={onOpen} />
      </span>
    ),
    edit: { type: 'text', placeholder: 'Company name', get: (l) => l.company, set: (_, v) => ({ company: v.trim() }) },
  },
  {
    key: 'name',
    header: 'Contact',
    icon: UserRound,
    className: 'min-w-36 whitespace-nowrap',
    sort: (l) => l.name.toLowerCase(),
    render: (l) => (
      <span className={l.name ? 'text-slate-700' : 'text-slate-400'}>
        {l.name || '—'} <span className="ref text-[11px] text-slate-400">{l.id}</span>
      </span>
    ),
    edit: { type: 'text', placeholder: 'Contact name', get: (l) => l.name, set: (_, v) => ({ name: v.trim() }) },
  },
  {
    key: 'need',
    header: 'Need and agent path',
    icon: MessageSquareText,
    className: 'w-full max-w-0',
    render: (l) => (
      <>
        <span className={cn('block truncate', l.need ? 'text-slate-700' : 'text-slate-400')} title={l.need}>{l.need || 'What do they want?'}</span>
        {l.steps.length > 0 && <ToolChain steps={l.steps} className="mt-1.5" />}
      </>
    ),
    edit: { type: 'text', placeholder: 'What do they want?', get: (l) => l.need, set: (_, v) => ({ need: v.trim() }) },
  },
  {
    key: 'score',
    header: 'Score',
    icon: Gauge,
    className: 'whitespace-nowrap',
    sort: (l) => l.score,
    // The score is Aria's qualification; a hand-added lead hasn't been scored yet.
    render: (l) =>
      l.steps.length ? (
        <span className={cn('ref inline-flex items-center gap-1', l.hot ? 'text-amber-700' : 'text-slate-600')}>
          {l.hot && <Flame className="size-3.5" aria-label="Hot lead" />}{l.score}
        </span>
      ) : (
        <span className="text-xs text-slate-400">Not scored</span>
      ),
  },
  {
    key: 'stage',
    header: 'Stage',
    icon: Columns3,
    className: 'whitespace-nowrap',
    sort: (l) => LEAD_STAGES.indexOf(l.stage),
    render: (l) => <StageBadge stage={l.stage} />,
    edit: {
      type: 'select',
      options: LEAD_STAGES.map((s) => ({ value: s, label: s })),
      renderOption: (s) => <StageBadge stage={s} />,
      get: (l) => l.stage,
      set: (_, v) => ({ stage: v }),
    },
  },
  {
    key: 'value',
    header: 'Deal value',
    icon: IndianRupee,
    className: 'whitespace-nowrap text-right',
    sort: (l) => l.value,
    render: (l) => <span className={cn('ref', l.value ? 'text-slate-900' : 'text-slate-400')}>{rupees(l.value)}</span>,
    edit: {
      type: 'number',
      placeholder: '₹ amount',
      get: (l) => l.value,
      // Accepts "8,60,000" or "₹860000"; anything that isn't a number is ignored.
      set: (_, v) => {
        const n = Number(v.replace(/[₹,\s]/g, '') || 0)
        return Number.isFinite(n) && n >= 0 ? { value: Math.round(n) } : null
      },
    },
  },
  {
    key: 'createdAt',
    header: 'Received',
    icon: Clock,
    className: 'whitespace-nowrap',
    sort: (l) => l.createdAt,
    render: (l) => <span className="text-xs text-slate-500">{ago(l.createdAt)}</span>,
  },
]

/** Sales: every enquiry the agent qualified, filtered by pipeline stage from the URL (?stage=). */
export default function Leads() {
  const { leads, setLeads, approvals, loading } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const stage = params.get('stage') ?? 'all'
  const stages = useMemo(() => [...new Set(leads.map((l) => l.stage))].sort(byStage), [leads])

  // Change one query param, keep the rest (stage filter and open lead are independent).
  const patch = useCallback((key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value == null) next.delete(key)
      else next.set(key, value)
      return next
    }), [setParams])

  const matches = useCallback((l: Lead) => {
    const s = q.trim().toLowerCase()
    return !s || [l.id, l.name, l.company, l.need].some((f) => f.toLowerCase().includes(s))
  }, [q])
  const filter = useCallback((l: Lead) => matches(l) && (stage === 'all' || l.stage === stage), [matches, stage])
  const searched = leads.filter(matches)

  const addLead = (): Lead => {
    // The new row must be visible to be edited: drop the filters it might not match.
    setQ('')
    patch('stage', null)
    return {
      id: nextId(leads), name: '', company: '', need: '', channel: 'manual', score: 0, value: 0, stage: 'New', hot: false,
      createdAt: new Date().toISOString(), steps: [],
    }
  }

  const open = useCallback((l: Lead) => patch('id', l.id), [patch])
  const cols = useMemo(() => columns(open), [open])
  const selected = leads.find((l) => l.id === params.get('id'))
  const gate = selected && approvals.pending.find((a) => a.ref === selected.id)
  const pipeline = leads.reduce((sum, l) => sum + l.value, 0)

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Business enquiries Aria qualified, scored and logged as deals in HubSpot. Edit any cell; every change can be undone."
      />

      <DataTable
        title="Pipeline"
        icon={Users}
        meta={`${leads.length} leads · ${rupees(pipeline)}`}
        label="Leads"
        rows={leads}
        getId={(l) => l.id}
        columns={cols}
        filter={filter}
        loading={loading}
        onRowsChange={(next) => setLeads(next)}
        onOpen={open}
        openId={selected?.id}
        onAddRow={addLead}
        addLabel="Add lead"
        bulkActions={[{ label: 'Delete', icon: Trash2, tone: 'danger', apply: () => ({ remove: true }) }]}
        toolbar={(
          <>
            <Tabs
              value={stage}
              onChange={(v: string) => patch('stage', v === 'all' ? null : v)}
              tabs={[{ value: 'all', label: 'All', count: searched.length }, ...stages.map((s) => ({ value: s, label: s, count: searched.filter((l) => l.stage === s).length }))]}
            />
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search leads"
                placeholder="ID, company, contact or need"
                className="h-8 w-60 rounded-full border border-ink/10 bg-ink/[0.03] pr-3 pl-9 text-[13px] outline-none placeholder:text-slate-400 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15"
              />
            </div>
          </>
        )}
        empty={<EmptyState icon={Users} title="No leads match" text="Pick another stage or clear the search." />}
      />

      <Drawer
        open={!!selected}
        onClose={() => patch('id', null)}
        title={selected && (
          <>
            <p className="text-xs font-medium text-slate-500"><span className="ref text-slate-700">{selected.id}</span> · received {ago(selected.createdAt)}</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{selected.need || 'New lead'}</h2>
          </>
        )}
        subtitle={selected && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{[selected.name, selected.company].filter(Boolean).join(' · ') || 'No contact yet'}</span>
            <StageBadge stage={selected.stage} />
          </div>
        )}
      >
        {selected && (
          <div className="p-6">
            <div className="mb-6 grid grid-cols-3 gap-3">
              <Stat label="Lead score" value={selected.steps.length ? selected.score : 'Not scored'} />
              <Stat label="Deal value" value={rupees(selected.value)} />
              <Stat label="Elapsed" value={selected.steps.length ? duration(selected.steps[0]!.time, selected.steps.at(-1)!.time) : '—'} />
            </div>
            {gate && (
              <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-800"><Hand className="size-4" aria-hidden />Waiting for your approval · {gate.reason}</p>
                <p className="mt-1 text-sm text-slate-700">{gate.suggestion}</p>
                <Link to="/approvals" className="mt-2 inline-block text-sm font-medium text-amber-800 underline-offset-2 hover:underline">Review in Approvals</Link>
              </div>
            )}
            {selected.steps.length ? (
              <>
                <Trace steps={selected.steps} />
                <Button size="sm" className="mt-6" icon={ScrollText} onClick={() => navigate(`/audit?ref=${selected.id}`)}>Open in audit log</Button>
              </>
            ) : (
              <p className="text-sm text-slate-500">Added by hand, so Aria hasn't worked on it yet.</p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg border border-slate-200 px-3 py-2.5">
    <p className="text-[11px] text-slate-500">{label}</p>
    <p className="ref mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
  </div>
)
