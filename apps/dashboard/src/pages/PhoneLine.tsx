import { useState, type CSSProperties } from 'react'
import { PhoneCall, PhoneIncoming, ArrowUpRight, Copy, Check, Plug, Lock, LockOpen, AudioLines } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import type { VoiceCall, VoiceLine } from '@ph/shared'
import { live } from '../api'
import { Panel, PageHeader, Badge, Drawer, EmptyState, Skeleton } from '../components/ui'
import { ago, clock, cn, num, secondsLabel } from '../lib'

// The Zendesk look-alike, where every call's ticket lands (ticket pages live at /tickets/:id).
const ZENDESK_URL: string = import.meta.env.VITE_ZENDESK_URL || 'http://localhost:3001'

const callerName = (c: VoiceCall) => c.customer?.name ?? (c.caller_phone || 'Unknown caller')

/** Mint bars: Aria is on a live call. */
function Waveform({ className }: { className?: string }) {
  return (
    <span className={cn('voice-bars inline-flex h-3.5 items-center gap-[2px]', className)} aria-hidden>
      {[0, 3, 1, 4, 2].map((b, i) => <span key={i} className="h-full" style={{ '--b': b } as CSSProperties} />)}
    </span>
  )
}

function TicketLink({ id }: { id: number | null }) {
  if (!id) return <span className="text-xs text-slate-400">—</span>
  return (
    <a
      href={`${ZENDESK_URL}/tickets/${id}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="ref inline-flex items-center gap-0.5 text-xs font-medium text-slate-900 hover:underline"
    >
      #{id}<ArrowUpRight className="size-3" aria-hidden />
    </a>
  )
}

/* ───────── The line ───────── */

function LinePanel({ line }: { line?: VoiceLine }) {
  return (
    <Panel icon={PhoneCall} title="ShopKart support line" meta="Sarvam voice agent">
      {!line ? <div className="p-5"><Skeleton className="h-24" /></div> : (
        <div className="p-5">
          <p className={cn('ref text-[28px] leading-none font-medium tracking-[-0.02em]', line.number ? 'text-slate-950' : 'text-slate-400')}>
            {line.number ?? 'No number yet'}
          </p>
          <p className="mt-2 flex items-center gap-2 text-[13px] text-slate-600">
            {line.live > 0 ? (
              <><Waveform /><span><span className="font-medium text-brand-700">Aria is on {line.live === 1 ? 'a call' : `${line.live} calls`}</span> right now</span></>
            ) : line.last_seen_at ? (
              <><span className="size-1.5 rounded-full bg-brand-500" aria-hidden />Answering · last call {ago(line.last_seen_at)}</>
            ) : (
              <><span className="size-1.5 rounded-full bg-slate-400" aria-hidden />Waiting for the first call</>
            )}
          </p>
          {!line.number && <p className="mt-2 text-xs text-slate-500">Set VOICE_NUMBER in .env, or it shows up after the first call.</p>}
          <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-ink/[0.06] pt-4">
            <Fact label="Calls today" value={num(line.calls_today)} />
            <Fact label="On a call now" value={num(line.live)} />
            <Fact label="Tickets from calls" value={num(line.tickets_today)} />
          </dl>
        </div>
      )}
    </Panel>
  )
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-[11px] text-slate-500">{label}</dt>
    <dd className="ref mt-0.5 text-base font-medium text-slate-950">{value}</dd>
  </div>
)

/* ───────── Setup: what to paste into Sarvam ───────── */

const HOOKS = [
  {
    when: 'When a call starts',
    where: 'API tool · run on_start',
    path: '/voice/caller',
    send: '{ "phone": @User Identifier, "interaction_id": @Interaction ID }',
    gets: 'Who is calling: first_name, orders_summary and a greeting. Save them as agent variables.',
  },
  {
    when: 'When the caller asks for something',
    where: 'API tool ask_resolveai · run mid-call',
    path: '/voice/turn',
    send: '{ "interaction_id": @Interaction ID, "phone": @User Identifier, "message": what the caller asked, in English }',
    gets: 'reply: say it to the caller as is. Aria looks up orders, refunds and escalates on the ticket.',
  },
  {
    when: 'When the call ends',
    where: 'Inbound deployment · webhook_config',
    path: '/voice/calls',
    send: 'Sarvam’s call-completion payload',
    gets: 'The transcript goes on the call’s ticket; a call Aria didn’t act on opens a ticket for a person.',
  },
]

function CopyUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard blocked: the URL is still selectable */ }
  }
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-ink/[0.07] bg-ink/[0.03] py-1 pr-1 pl-2.5">
      <span className="ref rounded bg-ink/[0.06] px-1 text-[10px] font-medium text-slate-600">POST</span>
      <code className="ref min-w-0 flex-1 truncate text-xs text-slate-900 select-all">{url}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${url}`}
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-slate-500 hover:bg-ink/[0.06] hover:text-slate-950"
      >
        {copied ? <Check className="size-3.5 text-brand-600" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

function SetupPanel({ line }: { line?: VoiceLine }) {
  const base = line?.public_url ?? 'http://localhost:4000'
  return (
    <Panel
      icon={Plug}
      title="Connect Sarvam"
      meta={line?.public_url ? 'public URL set' : 'local only'}
      footer={line && (
        <span className="flex items-center gap-1.5">
          {line.secured
            ? <><Lock className="size-3.5" aria-hidden />Calls need the bearer secret (VOICE_WEBHOOK_SECRET). Add it under the tool’s Auth.</>
            : <><LockOpen className="size-3.5" aria-hidden />No secret set: anyone with these URLs can call them. Set VOICE_WEBHOOK_SECRET before going live.</>}
        </span>
      )}
    >
      {line && !line.public_url && (
        <p className="border-b border-ink/[0.06] bg-ink/[0.02] px-4 py-2.5 text-xs text-slate-600">
          Sarvam can’t reach localhost. Run <code className="ref text-slate-900">ngrok http 4000</code> and put the https URL in
          <code className="ref text-slate-900"> VOICE_PUBLIC_URL</code>, then restart the API.
        </p>
      )}
      <ol className="divide-y divide-ink/[0.05]">
        {HOOKS.map((h) => (
          <li key={h.path} className="px-4 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-[13px] font-medium text-slate-950">{h.when}</p>
              <p className="text-[11px] text-slate-500">{h.where}</p>
            </div>
            <CopyUrl url={`${base}${h.path}`} />
            <p className="mt-2 text-xs text-slate-600"><span className="text-slate-500">Send</span> <code className="ref text-[11px] text-slate-700">{h.send}</code></p>
            <p className="mt-1 text-xs text-slate-600">{h.gets}</p>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/* ───────── Calls ───────── */

function CallsPanel({ calls, onOpen }: { calls?: VoiceCall[]; onOpen: (c: VoiceCall) => void }) {
  return (
    <Panel icon={PhoneIncoming} title="Calls" meta={calls && `${calls.length} recent`}>
      {!calls ? <div className="p-4"><Skeleton className="h-32" /></div> : calls.length === 0 ? (
        <EmptyState icon={PhoneIncoming} title="No calls yet" text="Call the line: Aria answers, and the call shows up here as it happens." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="text-xs text-slate-500">
              <tr className="border-b border-ink/[0.06]">
                <th className="px-4 py-2.5 font-medium">Caller</th>
                <th className="px-4 py-2.5 font-medium">Call</th>
                <th className="px-4 py-2.5 text-right font-medium">Asked Aria</th>
                <th className="px-4 py-2.5 font-medium">Ticket</th>
                <th className="px-4 py-2.5 text-right font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.05]">
              {calls.map((c) => (
                <tr
                  key={c.interaction_id}
                  tabIndex={0}
                  onClick={() => onOpen(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(c) } }}
                  className="cursor-pointer outline-none hover:bg-ink/[0.025] focus-visible:bg-ink/[0.04]"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-950">{callerName(c)}</p>
                    {c.customer && <p className="ref mt-0.5 text-xs text-slate-500">{c.caller_phone || `customer ${c.customer.id}`}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {c.status === 'live'
                      ? <span className="inline-flex items-center gap-2 text-xs font-medium text-brand-700"><Waveform />On the line</span>
                      : <span className="ref text-xs text-slate-600">{c.duration != null ? secondsLabel(c.duration) : 'Ended'}</span>}
                  </td>
                  <td className="ref px-4 py-3 text-right text-slate-950">{c.turns}</td>
                  <td className="px-4 py-3"><TicketLink id={c.ticket_id} /></td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{ago(c.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Transcript({ call }: { call: VoiceCall }) {
  const turns = call.transcript.filter((t) => t.en_text?.trim())
  if (!turns.length) {
    return (
      <p className="rounded-lg border border-ink/[0.07] bg-ink/[0.02] p-4 text-sm text-slate-600">
        {call.status === 'live'
          ? `Sarvam sends the transcript when the call ends. So far the voice agent has asked Aria ${call.turns} ${call.turns === 1 ? 'time' : 'times'}; what Aria did is on the ticket.`
          : 'This call came with no transcript.'}
      </p>
    )
  }
  return (
    <ol className="space-y-3">
      {turns.map((t, i) => {
        const aria = t.role === 'agent'
        const indic = t.indic_text?.trim() && t.indic_text.trim() !== t.en_text.trim() ? t.indic_text.trim() : null
        return (
          <li key={i} className={cn('flex gap-2.5', !aria && 'flex-row-reverse')}>
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-medium', aria ? 'bg-brand-100 text-brand-700' : 'bg-ink/[0.06] text-slate-600')} aria-hidden>
              {aria ? <ResolveAIGlyph className="size-3.5" /> : 'C'}
            </span>
            <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', aria ? 'rounded-tl-sm bg-brand-50 text-slate-900' : 'rounded-tr-sm bg-ink/[0.04] text-slate-900')}>
              <p className="sr-only">{aria ? 'Aria' : 'Caller'}:</p>
              <p>{t.en_text}</p>
              {indic && <p className="mt-1 text-xs text-slate-500" lang="hi">{indic}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Connect: the phone number Aria answers, through Sarvam's voice agent. Live from the demo API. */
export default function PhoneLine() {
  const line = live.useVoiceLine().data
  const calls = live.useVoiceCalls().data?.calls
  const [openId, setOpenId] = useState<string | null>(null)
  // Read the open call from the live list, so its status and transcript update while the drawer is open.
  const open = calls?.find((c) => c.interaction_id === openId) ?? null

  return (
    <div>
      <PageHeader
        title="Phone line"
        description="Customers call your ShopKart number. Sarvam’s voice agent does the talking in their language; Aria looks up orders, starts refunds and escalates. Every call becomes a Zendesk ticket."
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <LinePanel line={line} />
          <SetupPanel line={line} />
        </div>
        <CallsPanel calls={calls} onOpen={(c) => setOpenId(c.interaction_id)} />
      </div>

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open && (
          <>
            <p className="text-xs font-medium text-slate-500">
              <span className="ref text-slate-700">{open.caller_phone || 'Unknown number'}</span> · {clock(open.started_at)}
            </p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{callerName(open)}</h2>
          </>
        )}
        subtitle={open && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {open.status === 'live'
              ? <Badge className="bg-brand-50 text-brand-700 ring-brand-200"><Waveform className="h-3" />On the line</Badge>
              : <Badge className="bg-ink/[0.04] text-slate-700 ring-ink/10">{open.duration != null ? secondsLabel(open.duration) : 'Ended'}</Badge>}
            <span>Asked Aria {open.turns} {open.turns === 1 ? 'time' : 'times'}</span>
          </div>
        )}
        actions={open?.ticket_id && (
          <a
            href={`${ZENDESK_URL}/tickets/${open.ticket_id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-3 text-xs font-medium text-slate-800 hover:border-ink/15 hover:bg-ink/[0.07] hover:text-slate-950"
          >
            <ArrowUpRight className="size-3.5" aria-hidden />Ticket <span className="ref">#{open.ticket_id}</span>
          </a>
        )}
      >
        {open && (
          <div className="p-6">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-500"><AudioLines className="size-3.5" aria-hidden />Transcript</p>
            <Transcript call={open} />
          </div>
        )}
      </Drawer>
    </div>
  )
}
