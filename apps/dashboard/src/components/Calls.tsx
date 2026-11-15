// Voice calls (Sarvam) in the Control Room: the status/outcome badges, and "Call with Aria" for a lead.
// A call is a real phone call: the API places it through Sarvam, and the result (outcome, score, the
// fields the voice agent extracted, transcript) comes back on the call record.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, PhoneCall, Loader2, TriangleAlert, ArrowUpRight, RefreshCw } from 'lucide-react'
import type { Call, CallStatus } from '@ph/shared'
import { api, errorText, live } from '../api'
import { useApp } from '../store'
import { Badge, Button } from './ui'
import { ago, cn } from '../lib'
import { CALL_OUTCOME, CALL_STATUS, callDuration, isLive } from './callMeta'

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
export function RealCallWarning({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800', className)}>
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>This places a real phone call through Sarvam. Aria's voice agent will ring the number and talk to whoever answers.</span>
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
