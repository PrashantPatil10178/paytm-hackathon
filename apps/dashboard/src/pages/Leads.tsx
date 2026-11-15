import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Flame, ScrollText, Users, Hand } from 'lucide-react'
import { useApp } from '../store'
import { Card, PageHeader, Tabs, Drawer, Button, Badge, EmptyState, Skeleton, ChannelTag } from '../components/ui'
import Trace from '../components/Trace'
import ToolChain from '../components/ToolChain'
import { byStage } from '../nav'
import { ago, cn, duration, rupees } from '../lib'

const STAGE_BADGE = 'bg-slate-100 text-slate-700 ring-slate-200'

/** Sales: every enquiry the agent qualified, filtered by pipeline stage from the URL (?stage=). */
export default function Leads() {
  const { leads, approvals, loading } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  const stage = params.get('stage') ?? 'all'
  const stages = useMemo(() => [...new Set(leads.map((l) => l.stage))].sort(byStage), [leads])

  // Change one query param, keep the rest (stage filter and open lead are independent).
  const patch = (key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value == null) next.delete(key)
      else next.set(key, value)
      return next
    })

  const base = useMemo(() => {
    const s = q.trim().toLowerCase()
    return leads
      .filter((l) => !s || [l.id, l.name, l.company, l.need].some((f) => f.toLowerCase().includes(s)))
      .sort((a, b) => b.score - a.score)
  }, [leads, q])
  const rows = stage === 'all' ? base : base.filter((l) => l.stage === stage)

  const selected = leads.find((l) => l.id === params.get('id'))
  const gate = selected && approvals.pending.find((a) => a.ref === selected.id)

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Business enquiries Aria qualified, scored and logged as deals in HubSpot. Highest score first."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Tabs
            value={stage}
            onChange={(v: string) => patch('stage', v === 'all' ? null : v)}
            tabs={[{ value: 'all', label: 'All', count: base.length }, ...stages.map((s) => ({ value: s, label: s, count: base.filter((l) => l.stage === s).length }))]}
          />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search leads"
              placeholder="ID, company, contact or need"
              className="h-9 w-60 rounded-lg border border-slate-200 bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15"
            />
          </div>
        </div>

        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                {['Lead', 'Need and agent path', 'Score', 'Stage', 'Deal value', 'Received'].map((h, i) => (
                  <th key={h} scope="col" className={cn('py-3 font-medium', i === 0 ? 'px-5' : 'px-3', i === 4 && 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}><td colSpan={6} className="px-5 py-3"><Skeleton className="h-8" /></td></tr>
              ))}
              {rows.map((l) => (
                <tr
                  key={l.id}
                  tabIndex={0}
                  onClick={() => patch('id', l.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); patch('id', l.id) } }}
                  className="cursor-pointer outline-none transition-colors hover:bg-slate-50 focus-visible:bg-slate-50"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ChannelTag channel={l.channel} compact />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{l.company}</p>
                        <p className="truncate text-xs text-slate-500">{l.name} · <span className="ref">{l.id}</span></p>
                      </div>
                    </div>
                  </td>
                  <td className="max-w-sm px-3 py-3">
                    <p className="line-clamp-1 text-slate-700">{l.need}</p>
                    <ToolChain steps={l.steps} className="mt-1.5" />
                  </td>
                  <td className="px-3 py-3">
                    <span className={cn('ref inline-flex items-center gap-1', l.hot ? 'text-amber-700' : 'text-slate-600')}>
                      {l.hot && <Flame className="size-3.5" aria-label="Hot lead" />}{l.score}
                    </span>
                  </td>
                  <td className="px-3 py-3"><Badge className={STAGE_BADGE}>{l.stage}</Badge></td>
                  <td className="ref px-3 py-3 text-right text-slate-900">{rupees(l.value)}</td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-500">{ago(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <EmptyState icon={Users} title="No leads match" text="Pick another stage or clear the search." />
          )}
        </div>
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => patch('id', null)}
        title={selected && (
          <>
            <p className="text-xs font-medium text-slate-500"><span className="ref text-slate-700">{selected.id}</span> · received {ago(selected.createdAt)}</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{selected.need}</h2>
          </>
        )}
        subtitle={selected && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{selected.name} · {selected.company}</span>
            <Badge className={STAGE_BADGE}>{selected.stage}</Badge>
          </div>
        )}
      >
        {selected && (
          <div className="p-6">
            <div className="mb-6 grid grid-cols-3 gap-3">
              <Stat label="Lead score" value={selected.score} />
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
            <Trace steps={selected.steps} />
            <Button size="sm" className="mt-6" icon={ScrollText} onClick={() => navigate(`/audit?ref=${selected.id}`)}>Open in audit log</Button>
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
