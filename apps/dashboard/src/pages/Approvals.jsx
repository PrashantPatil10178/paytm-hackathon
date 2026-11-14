import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X, Sparkles, PartyPopper, Clock, ShieldAlert, Wallet, Handshake } from 'lucide-react'
import { useApp } from '../store'
import { Card, PageHeader, Tabs, Button, Badge, Modal, EmptyState } from '../components/ui'
import { ago, cn, rupees } from '../lib'

const TONE = {
  amber: { badge: 'bg-amber-50 text-amber-800 ring-amber-200', icon: Wallet },
  red: { badge: 'bg-red-50 text-red-700 ring-red-200', icon: ShieldAlert },
  indigo: { badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200', icon: Handshake },
}

export default function Approvals() {
  const { approvals, decideApproval } = useApp()
  const [tab, setTab] = useState('pending')
  const [rejecting, setRejecting] = useState(null)
  const [note, setNote] = useState('')
  const [leaving, setLeaving] = useState({})

  const decide = (id, decision, n) => {
    setLeaving((l) => ({ ...l, [id]: decision }))
    setTimeout(() => {
      decideApproval(id, decision, n)
      setLeaving((l) => { const { [id]: _, ...rest } = l; return rest })
    }, 220)
  }

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="The agent pauses here when an action crosses a guardrail. You decide, and it carries on."
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'pending', label: 'Pending', count: approvals.pending.length }, { value: 'history', label: 'History', count: approvals.history.length }]}
      />

      {tab === 'pending' && (
        approvals.pending.length === 0 ? (
          <Card><EmptyState icon={PartyPopper} title="All caught up" text="No actions are waiting for you. The agent will ping you when something needs a human." /></Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {approvals.pending.map((a) => {
              const tone = TONE[a.tone]
              return (
                <Card
                  key={a.id}
                  className={cn('relative flex flex-col overflow-hidden transition-[opacity,transform,box-shadow] duration-200',
                    leaving[a.id] && 'scale-[0.98] opacity-0', leaving[a.id] === 'approved' && 'ring-2 ring-brand-500')}
                >
                  <div className="flex-1 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={tone.badge}><tone.icon className="size-3" />{a.reason}</Badge>
                      <Link to={a.kind === 'ticket' ? `/tickets?id=${a.ref}` : `/audit?ref=${a.ref}`} className="ref text-xs font-medium text-brand-700 hover:underline">{a.ref}</Link>
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 tabular"><Clock className="size-3" aria-hidden />waiting {ago(a.createdAt).replace(' ago', '')}</span>
                    </div>
                    <div className="mt-3 flex items-baseline justify-between gap-3">
                      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-slate-900">{a.customer}</h3>
                      <span className="text-xl font-semibold tracking-[-0.02em] text-slate-900 tabular">{rupees(a.amount)}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-600">{a.summary}</p>

                    <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50/50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-brand-700"><Sparkles className="size-3.5" />Suggested action</p>
                      <p className="mt-1 text-sm text-slate-800">{a.suggestion}</p>
                    </div>

                    <ul className="mt-3 space-y-1">
                      {a.evidence.map((e) => (
                        <li key={e} className="flex items-start gap-2 text-xs text-slate-500"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-300" />{e}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-slate-500">AI confidence</p>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${a.confidence * 100}%` }} />
                        </div>
                        <span className="text-xs font-medium text-slate-700 tabular">{Math.round(a.confidence * 100)}%</span>
                      </div>
                    </div>
                    <Button variant="danger" size="sm" icon={X} onClick={() => { setRejecting(a); setNote('') }}>Reject</Button>
                    <Button variant="primary" size="sm" icon={Check} onClick={() => decide(a.id, 'approved')}>Approve</Button>
                  </div>
                </Card>
              )
            })}
          </div>
        )
      )}

      {tab === 'history' && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {approvals.history.map((h) => (
              <li key={h.id + h.decidedAt} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-sm">
                <span className={cn('grid size-8 place-items-center rounded-full', h.decision === 'approved' ? 'bg-brand-50 text-brand-600' : 'bg-red-50 text-red-600')}>
                  {h.decision === 'approved' ? <Check className="size-4" /> : <X className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{h.customer} <span className="font-normal text-slate-500">· <span className="ref">{h.ref}</span> · {h.reason}</span></p>
                  <p className="text-xs text-slate-500">
                    {h.decision === 'approved' ? 'Approved' : 'Rejected'} by {h.by} · {ago(h.decidedAt)}{h.note ? ` · "${h.note}"` : ''}
                  </p>
                </div>
                <span className="font-medium text-slate-900 tabular">{rupees(h.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.id}?`}
        subtitle="The ticket goes to a human agent. Add a note so the agent learns from it."
        footer={<>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button variant="destructive" onClick={() => { decide(rejecting.id, 'rejected', note.trim()); setRejecting(null) }}>Reject action</Button>
        </>}
      >
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. Offer a replacement instead of a refund"
          className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500"
        />
      </Modal>
    </div>
  )
}
