import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, X, Download, ExternalLink, ScrollText } from 'lucide-react'
import { useApp, useAuditLog } from '../store'
import { Card, PageHeader, Tabs, Select, ResultBadge, ToolTag, Drawer, Button, LevelBadge, StatusBadge, EmptyState, Badge } from '../components/ui'
import Trace from '../components/Trace'
import { clockSec, cn, duration, rupees } from '../lib'

const csvCell = (v) => {
  const t = String(v ?? '')
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** Downloads the rows on screen as audit-log.csv. */
function exportCsv(rows) {
  const head = ['time', 'ref', 'kind', 'who', 'step', 'tool', 'result', 'detail']
  const lines = [head.join(','), ...rows.map((a) => head.map((k) => csvCell(a[k])).join(','))]
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: 'audit-log.csv' })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Audit() {
  const audit = useAuditLog()
  const { tickets, conversations, leads, toast } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [tool, setTool] = useState('all')
  const [result, setResult] = useState('all')
  const [focusKey, setFocusKey] = useState(null)

  const openRef = params.get('ref')
  const tools = useMemo(() => [...new Set(audit.map((a) => a.tool))].sort(), [audit])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return audit.filter(
      (a) =>
        (tool === 'all' || a.tool === tool) &&
        (!s || a.ref.toLowerCase().includes(s) || a.who.toLowerCase().includes(s) || a.step.toLowerCase().includes(s) || a.detail.toLowerCase().includes(s)),
    )
  }, [audit, q, tool])
  const rows = result === 'all' ? filtered : filtered.filter((a) => a.result === result)
  const count = (r) => filtered.filter((a) => a.result === r).length

  const subject = openRef && (tickets.find((t) => t.id === openRef) || conversations.find((c) => c.id === openRef) || leads.find((l) => l.id === openRef))
  const highlight = subject && focusKey ? subject.steps.findIndex((_, i) => `${openRef}-${i}` === focusKey) : -1
  const open = (row) => { setFocusKey(row.key); setParams({ ref: row.ref }) }
  const close = () => { setFocusKey(null); setParams({}) }
  // A chat Aria answered without a ticket has a customer too, but no status, amount or helpdesk.
  const isChat = subject && subject.id.startsWith('C-')
  const isTicket = subject && 'customer' in subject && !isChat
  const filtersOn = q || tool !== 'all' || result !== 'all'

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every step the agent took, with the tool it used and the outcome. Nothing happens off the record."
        actions={<Button icon={Download} disabled={rows.length === 0} onClick={() => { exportCsv(rows); toast({ title: 'Exported audit-log.csv', desc: `${rows.length} rows` }) }}>Export CSV</Button>}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ticket / chat / lead ID, customer, step…"
              className="h-9 w-full rounded-lg border border-slate-200 pr-3 pl-9 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>
          <Select label="Tool" value={tool} onChange={setTool} options={[{ value: 'all', label: 'All tools' }, ...tools.map((t) => ({ value: t, label: t }))]} />
          <Tabs
            value={result}
            onChange={setResult}
            tabs={[
              { value: 'all', label: 'All', count: filtered.length },
              { value: 'success', label: 'Success', count: count('success') },
              { value: 'blocked', label: 'Blocked', count: count('blocked') },
              { value: 'escalated', label: 'Escalated', count: count('escalated') },
            ]}
          />
          {filtersOn && (
            <button onClick={() => { setQ(''); setTool('all'); setResult('all') }} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
              <X className="size-4" /> Clear
            </button>
          )}
        </div>

        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                <th className="px-5 py-3 font-medium">Time</th>
                <th className="px-3 py-3 font-medium">Ticket / chat / lead</th>
                <th className="px-3 py-3 font-medium">Step</th>
                <th className="px-3 py-3 font-medium">Tool</th>
                <th className="px-3 py-3 font-medium">Detail</th>
                <th className="px-5 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.key} onClick={() => open(a)} className={cn('cursor-pointer transition hover:bg-slate-50', a.result !== 'success' && 'bg-amber-50/20')}>
                  <td className="ref px-5 py-3 text-xs whitespace-nowrap text-slate-500">{clockSec(a.time)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="ref font-medium text-brand-700">{a.ref}</span>
                    <span className="block text-xs text-slate-500">{a.who}</span>
                  </td>
                  <td className="px-3 py-3 font-medium whitespace-nowrap text-slate-800">{a.step}</td>
                  <td className="px-3 py-3 whitespace-nowrap"><ToolTag tool={a.tool} /></td>
                  <td className="max-w-sm px-3 py-3 text-slate-600"><span className="line-clamp-1">{a.detail}</span></td>
                  <td className="px-5 py-3"><ResultBadge result={a.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0
            ? <EmptyState icon={ScrollText} title="No agent activity yet" text="Every step Aria takes on a ticket or lead (the tool it used and the outcome) is recorded here. Start a ShopKart chat to see the first ones." />
            : rows.length === 0 && <EmptyState icon={ScrollText} title="No matching actions" text="Try a different ticket ID or clear the filters." />}
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Showing {rows.length} of {audit.length} actions · click a row to see the full trace
        </div>
      </Card>

      <Drawer
        open={!!subject}
        onClose={close}
        title={
          subject && (
            <>
              <p className="text-xs font-medium text-slate-500">Trace · {subject.id}</p>
              <h2 className="mt-0.5 truncate text-base font-semibold text-slate-900">{isTicket || isChat ? subject.issue : subject.need}</h2>
            </>
          )
        }
        subtitle={
          subject && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              {isChat ? (
                <><span>{subject.customer.name}</span>{subject.level && <LevelBadge level={subject.level} />}<Badge className="bg-brand-50 text-brand-700 ring-brand-100">Answered in chat · no ticket</Badge></>
              ) : isTicket ? (
                <><span>{subject.customer.name}</span><LevelBadge level={subject.level} /><StatusBadge status={subject.status} /></>
              ) : (
                <><span>{[subject.name, subject.company].filter(Boolean).join(' · ')}</span><Badge className="bg-slate-100 text-slate-700 ring-slate-200">Lead score {subject.score}</Badge></>
              )}
            </div>
          )
        }
      >
        {subject && (
          <div className="p-6">
            <div className="mb-6 grid grid-cols-3 gap-3">
              <Stat label="Steps" value={subject.steps.length} />
              <Stat label="Elapsed" value={subject.steps.length ? duration(subject.steps[0].time, subject.steps.at(-1).time) : '—'} />
              {isChat
                ? <Stat label="Answered in" value={duration(subject.createdAt, subject.answeredAt)} />
                : <Stat label={isTicket ? 'Amount' : 'Deal value'} value={rupees(isTicket ? subject.amount : subject.value)} />}
            </div>
            <Trace steps={subject.steps} highlight={highlight} />
            {isChat && (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Aria's answer</p>
                <p className="mt-1 text-sm text-slate-700">{subject.result}</p>
                <Button size="sm" className="mt-3" icon={ExternalLink} onClick={() => navigate(`/conversations?id=${subject.id}`)}>Open conversation</Button>
              </div>
            )}
            {isTicket && (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Outcome</p>
                <p className="mt-1 text-sm text-slate-700">{subject.result || 'Still in progress.'}</p>
                <Button size="sm" className="mt-3" icon={ExternalLink} onClick={() => navigate(`/tickets?id=${subject.id}`)}>Open ticket</Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}

const Stat = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 px-3 py-2.5">
    <p className="text-[11px] text-slate-500">{label}</p>
    <p className="mt-0.5 text-sm font-semibold text-slate-900 tabular">{value}</p>
  </div>
)
