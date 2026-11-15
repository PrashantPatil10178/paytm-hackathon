// Labels and helpers for voice calls (Sarvam), shared by components/Calls.tsx and pages/Calls.tsx.
import type { Call, CallExtraction, CallOutcome, CallStatus, InfoOutcome } from '@ph/shared'

export const CALL_STATUS: Record<CallStatus, { label: string; badge: string; dot: string; live?: boolean }> = {
  queued: { label: 'Queued', badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400', live: true },
  ringing: { label: 'Ringing', badge: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500', live: true },
  in_progress: { label: 'On the call', badge: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500', live: true },
  completed: { label: 'Completed', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  no_answer: { label: 'No answer', badge: 'bg-slate-100 text-slate-700 ring-slate-200', dot: 'bg-slate-400' },
  failed: { label: 'Failed', badge: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' },
}

export const CALL_OUTCOME: Record<CallOutcome, string> = {
  meeting_booked: 'Meeting booked',
  send_details: 'Send details',
  callback: 'Call back',
  not_interested: 'Not interested',
  do_not_call: 'Do not call',
  wrong_person: 'Wrong person',
  unclear: 'Unclear',
}

export const isLive = (c: Call) => !!CALL_STATUS[c.status]?.live

export const callDuration = (s: number | null) =>
  s == null ? '—' : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`


/** How a support call went (the Support Caller's info_outcome). */
export const INFO_OUTCOME: Record<InfoOutcome, string> = {
  info_collected: 'Got the details',
  partial: 'Got some details',
  callback: 'Call back later',
  declined: "Didn't want to share",
  wrong_person: 'Wrong person',
  unclear: 'Unclear',
}

export const WANTS: Record<NonNullable<CallExtraction['wants']>, string> = {
  refund: 'Refund', replacement: 'Replacement', return: 'Return', cancel: 'Cancel the order',
  delivery_update: 'Delivery update', information: 'An answer', other: 'Something else', not_discussed: 'Not discussed',
}

/** The outcome label for any call: the sales outcome or the support one. */
export const outcomeLabel = (c: Call): string | null =>
  c.purpose === 'support'
    ? (c.extracted.info_outcome ? INFO_OUTCOME[c.extracted.info_outcome] : null)
    : c.outcome ? (CALL_OUTCOME[c.outcome] ?? c.outcome) : null
