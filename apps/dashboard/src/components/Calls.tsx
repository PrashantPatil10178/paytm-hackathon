// Voice calls (Sarvam) in the Control Room: the status/outcome badges, and "Call with Aria" for a lead.
// A call is a real phone call: the API places it through Sarvam, and the result (outcome, score, the
// fields the voice agent extracted, transcript) comes back on the call record.
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Phone, PhoneCall, Loader2, TriangleAlert, ArrowUpRight, RefreshCw, Languages } from 'lucide-react'
import type { Call, CallStatus } from '@ph/shared'
import { api, errorText, live } from '../api'
import { useApp } from '../store'
import { Badge, Button } from './ui'
import { ago, cn } from '../lib'
import { CALL_OUTCOME, CALL_STATUS, callDuration, isLive, outcomeLabel } from './callMeta'
import type { Ticket } from '../types'

export function CallStatusBadge({ status }: { status: CallStatus }) {
  const s = CALL_STATUS[status] ?? CALL_STATUS.queued
  return (
    <Badge className={s.badge} dot={s.live ? undefined : s.dot}>
      {s.live && <span className={cn('size-1.5 animate-pulse rounded-full', s.dot)} />}
      {s.label}
    </Badge>
  )
}

export function ScoreChip({ score }: { score: Call['lead_score'] }) {
  if (!score) return <span className="text-xs text-slate-400">—</span>
  return <span className={cn('ref text-xs font-medium', score === 'hot' ? 'text-amber-700' : 'text-slate-700')}>{score}</span>
}

/** The warning shown before any call is placed. */
export function RealCallWarning({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800', className)}>
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children ?? "This places a real phone call through Sarvam. Aria's voice agent will ring the number and talk to whoever answers."}</span>
    </p>
  )
}

/**
 * "Call with Aria" for one CRM deal (a lead). Asks for confirmation, POSTs the call, then shows the newest
 * call about this deal live as it rings, runs and finishes.
 */
export function CallWithAria({ dealId, name }: { dealId: number; name?: string }) {
  const { toast } = useApp()
  const { data, error, refresh } = live.useCalls()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const calls = data?.calls.filter((c) => c.deal_id === dealId) ?? []
  const latest = calls[0]

  const place = async () => {
    setBusy(true)
    try {
      await api.placeCall({ deal_id: dealId })
      await refresh()
      toast({ title: `Calling ${name || 'the lead'}`, desc: 'Aria is placing the call now.' })
      setConfirming(false)
    } catch (e) {
      toast({ tone: 'neutral', title: 'Couldn’t place the call', desc: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  const sync = async (c: Call) => {
    setSyncing(true)
    try {
      await api.syncCall(c.id)
      await refresh()
    } catch (e) {
      toast({ tone: 'neutral', title: 'Couldn’t refresh the call', desc: errorText(e) })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="rounded-xl border border-ink/[0.08] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg border border-ink/[0.08] bg-ink/[0.03] text-slate-600"><Phone className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">Voice call</p>
          <p className="text-xs text-slate-500">
            {latest ? <>Last call {ago(latest.created_at)} · {calls.length} in total</> : 'Aria can call this lead, qualify them and log the result.'}
          </p>
        </div>
        {!confirming && (
          <Button size="sm" variant="primary" icon={PhoneCall} onClick={() => setConfirming(true)} disabled={!!latest && isLive(latest)}>
            Call with Aria
          </Button>
        )}
      </div>

      {confirming && (
        <div className="mt-3">
          <RealCallWarning />
          <div className="mt-2.5 flex justify-end gap-2">
            <Button size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" icon={busy ? Loader2 : PhoneCall} className={busy ? '[&>svg]:animate-spin' : ''} onClick={place} disabled={busy}>
              {busy ? 'Placing call' : 'Place the call'}
            </Button>
          </div>
        </div>
      )}

      {error && !data && <p className="mt-3 text-xs text-red-700">Can't load calls: {error}</p>}

      {latest && (
        <div className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <CallStatusBadge status={latest.status} />
            {latest.outcome && <span className="font-medium text-slate-800">{CALL_OUTCOME[latest.outcome] ?? latest.outcome}</span>}
            {latest.lead_score && <span className="text-slate-500">· score <ScoreChip score={latest.lead_score} /></span>}
            <span className="ref text-slate-500">· {callDuration(latest.duration_s)}</span>
            <span className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" icon={syncing ? Loader2 : RefreshCw} className={syncing ? '[&>svg]:animate-spin' : ''} onClick={() => sync(latest)} disabled={syncing}>Refresh</Button>
              <Link to={`/calls?id=${latest.id}`} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 font-medium text-slate-500 hover:bg-ink/[0.05] hover:text-slate-950">
                Details<ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </span>
          </div>
          {(latest.summary || latest.extracted.call_summary) && <p className="mt-2 leading-relaxed text-slate-700">{latest.summary || latest.extracted.call_summary}</p>}
          {latest.error && <p className="mt-2 text-red-700">{latest.error}</p>}
        </div>
      )}
    </section>
  )
}

/** Default details to collect, by what the ticket is about. */
function defaultQuestions(t: Ticket, knowsOrder: boolean): string[] {
  const issue = t.issue.toLowerCase()
  const which = knowsOrder ? [] : ['Which order or product it is about']
  if (/damag|broken|torn|defect|wrong item/.test(issue)) return [...which, 'What exactly is wrong with it', 'Whether they want a refund or a replacement']
  if (/payment|debited|charged/.test(issue)) return [...(knowsOrder ? [] : ['Which order the payment was for']), 'How much was debited and when', 'Which payment method was used']
  return [...which, 'What exactly they need help with']
}

/**
 * "Call customer for details" on a ticket: Aria · Support Caller phones the customer (in their state's
 * language, switching to whatever they speak), collects what the ticket is missing, and the answers come
 * back onto the ticket and continue the request in their chat. Shows this ticket's calls live.
 */
export function CallForDetails({ ticket }: { ticket: Ticket }) {
  const { toast } = useApp()
  const { data, refresh } = live.useCalls()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [questions, setQuestions] = useState('')
  const [busy, setBusy] = useState(false)
  const [who, setWho] = useState<{ customerId: number; name: string; orderId: number | null } | null>(null)
  const [context, setContext] = useState<string | null>(null)
  const calls = data?.calls.filter((c) => c.purpose === 'support' && String(c.ticket_id) === ticket.id) ?? []
  const latest = calls[0]

  const start = async () => {
    setReason(`you contacted us about "${ticket.issue}", and we need a few more details to sort it out`)
    setContext(null)
    setOpen(true)
    try {
      // The customer and order behind the ticket, and what Aria will be told about them on the call.
      const c = await api.ticketCustomer(ticket.id)
      setWho(c)
      setQuestions(defaultQuestions(ticket, c.orderId != null).join('\n'))
      const ctx = await api.callContext(c.customerId, ticket.id, c.orderId)
      setContext(ctx.customer_context)
    } catch (e) {
      setQuestions(defaultQuestions(ticket, false).join('\n'))
      toast({ tone: 'neutral', title: 'Couldn’t load the customer’s records', desc: errorText(e) })
    }
  }
  const place = async () => {
    const qs = questions.split('\n').map((q) => q.trim()).filter(Boolean).slice(0, 3)
    if (!reason.trim() || !qs.length) return
    setBusy(true)
    try {
      const c = who ?? (await api.ticketCustomer(ticket.id))
      await api.placeCall({ purpose: 'support', customer_id: c.customerId, ticket_id: Number(ticket.id), reason: reason.trim(), questions: qs, order_id: c.orderId })
      await refresh()
      toast({ title: `Calling ${c.name}`, desc: 'Aria · Support Caller is placing the call.' })
      setOpen(false)
    } catch (e) {
      toast({ tone: 'neutral', title: 'Couldn’t place the call', desc: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500'
  return (
    <section className="rounded-xl border border-ink/[0.08] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-8 place-items-center rounded-lg border border-ink/[0.08] bg-ink/[0.03] text-slate-600"><Phone className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">Call for details</p>
          <p className="text-xs text-slate-500">
            {latest ? <>Last call {ago(latest.created_at)} · {calls.length} on this ticket</> : 'Aria phones the customer in their language and collects what this ticket is missing.'}
          </p>
        </div>
        {!open && (
          <Button size="sm" icon={PhoneCall} onClick={start} disabled={!!latest && isLive(latest)}>Call customer</Button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Why Aria is calling</span>
            <textarea rows={2} className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Details to collect, one per line (up to 3, so the call stays short)</span>
            <textarea rows={3} className={field} value={questions} onChange={(e) => setQuestions(e.target.value)} />
          </label>
          <details className="rounded-lg border border-ink/[0.08] px-3 py-2 text-xs text-slate-600" open>
            <summary className="cursor-pointer font-medium text-slate-700">What Aria will know on the call</summary>
            {context == null
              ? <p className="mt-2 text-slate-500">Loading the customer’s records…</p>
              : <p className="mt-2 leading-relaxed whitespace-pre-line text-slate-700">{context}</p>}
            <p className="mt-2 text-slate-500">Verified from ShopKart’s records. Aria confirms these with the customer instead of asking again, and can answer questions about them.</p>
          </details>
          <RealCallWarning>
            This places a real phone call through Sarvam. With SARVAM_TEST_NUMBER set it rings the test number instead of the customer's. Aria opens with a short greeting and then speaks whatever language the customer answers in.
          </RealCallWarning>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" variant="primary" icon={busy ? Loader2 : PhoneCall} className={busy ? '[&>svg]:animate-spin' : ''} onClick={place} disabled={busy || !reason.trim() || !questions.trim()}>
              {busy ? 'Placing call' : 'Place the call'}
            </Button>
          </div>
        </div>
      )}

      {latest && (
        <div className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <CallStatusBadge status={latest.status} />
            {outcomeLabel(latest) && <span className="font-medium text-slate-800">{outcomeLabel(latest)}</span>}
            {(latest.extracted.language_used || latest.language) && (
              <span className="inline-flex items-center gap-1 text-slate-500"><Languages className="size-3" aria-hidden />{latest.extracted.language_used ?? latest.language}</span>
            )}
            <span className="ref text-slate-500">· {callDuration(latest.duration_s)}</span>
            <Link to={`/support/calls?id=${latest.id}`} className="ml-auto inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 font-medium text-slate-500 hover:bg-ink/[0.05] hover:text-slate-950">
              Details<ArrowUpRight className="size-3" aria-hidden />
            </Link>
          </div>
          {latest.summary && <p className="mt-2 leading-relaxed text-slate-700">{latest.summary}</p>}
          {latest.error && <p className="mt-2 text-red-700">{latest.error}</p>}
        </div>
      )}
    </section>
  )
}
