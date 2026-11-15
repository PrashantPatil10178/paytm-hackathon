import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Phone, PhoneCall, Loader2, RefreshCw, UserRound, ArrowUpRight, Search } from 'lucide-react'
import type { Call, CallExtraction } from '@ph/shared'
import { api, errorText, live } from '../api'
import { useApp } from '../store'
import { Button, Drawer, EmptyState, Modal, PageHeader, Panel, SectionTitle, Skeleton, Tabs } from '../components/ui'
import { CallStatusBadge, RealCallWarning, ScoreChip } from '../components/Calls'
import { CALL_OUTCOME, CALL_STATUS, callDuration, isLive } from '../components/callMeta'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { ago, clock, cn, rupees } from '../lib'

type View = 'all' | 'live' | 'completed' | 'unreached'
const VIEW: Record<View, (c: Call) => boolean> = {
  all: () => true,
  live: isLive,
  completed: (c) => c.status === 'completed',
  unreached: (c) => c.status === 'no_answer' || c.status === 'failed',
}

/** Sales: every call Aria's voice agent placed through Sarvam, live, with what it learned. */
export default function Calls() {
  const { data, error, refresh } = live.useCalls()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>('all')
  const [q, setQ] = useState('')
  const [placing, setPlacing] = useState(false)

  const calls = data?.calls ?? []
  const s = q.trim().toLowerCase()
  const searched = calls.filter((c) => !s || [c.name, c.business_name, c.phone].some((f) => f?.toLowerCase().includes(s)))
  const rows = searched.filter(VIEW[view])
  const selected = calls.find((c) => String(c.id) === params.get('id'))
  const open = (c: Call | null) => setParams(c ? { id: String(c.id) } : {})

  return (
    <div>
      <PageHeader
        title="Calls"
        description="Sales calls Aria's voice agent placed through Sarvam: who it rang, how it went, and what it learned."
        actions={<Button variant="primary" icon={PhoneCall} onClick={() => setPlacing(true)}>New call</Button>}
      />

      <Panel
        icon={Phone}
        title="Voice calls"
        meta={data ? `${calls.length} calls` : undefined}
        action={(
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search calls" placeholder="Name, business or phone" className="h-8 w-52 rounded-full border border-ink/10 bg-ink/[0.03] pr-3 pl-9 text-[13px] outline-none placeholder:text-slate-400 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15" />
          </div>
        )}
      >
        <div className="border-b border-ink/[0.06] px-3 py-2.5">
          <Tabs
            value={view}
            onChange={setView}
            tabs={[
              { value: 'all', label: 'All', count: searched.length },
              { value: 'live', label: 'In progress', count: searched.filter(VIEW.live).length },
              { value: 'completed', label: 'Completed', count: searched.filter(VIEW.completed).length },
              { value: 'unreached', label: 'Not reached', count: searched.filter(VIEW.unreached).length },
            ]}
          />
        </div>
        {!data && !error && <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
        {!data && error && <EmptyState icon={Phone} title="Calls aren't available" text={`The demo API didn't return calls: ${error}`} />}
        {data && calls.length === 0 && (
          <EmptyState
            icon={Phone}
            title="No calls yet"
            text="Open a lead and press Call with Aria, or place one here with New call. Each call and its result shows up here."
            action={<Button icon={PhoneCall} onClick={() => setPlacing(true)}>New call</Button>}
          />
        )}
        {data && calls.length > 0 && rows.length === 0 && <EmptyState icon={Search} title="No calls match" text="Pick another view or clear the search." />}
        {rows.length > 0 && (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="border-b border-ink/[0.06] text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Who</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Outcome</th>
                  <th className="px-3 py-2.5 font-medium">Lead score</th>
                  <th className="px-3 py-2.5 text-right font-medium">Duration</th>
                  <th className="px-4 py-2.5 text-right font-medium">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/[0.06]">
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => open(c)} className={cn('cursor-pointer transition-colors hover:bg-ink/[0.025]', selected?.id === c.id && 'bg-ink/[0.03]')}>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-slate-900">{c.name || 'Unknown'}{c.business_name && <span className="font-normal text-slate-500"> · {c.business_name}</span>}</span>
                      <span className="ref block text-xs text-slate-500">{c.phone}</span>
                    </td>
                    <td className="px-3 py-3"><CallStatusBadge status={c.status} /></td>
                    <td className="px-3 py-3 text-slate-700">{c.outcome ? CALL_OUTCOME[c.outcome] ?? c.outcome : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-3"><ScoreChip score={c.lead_score} /></td>
                    <td className="ref px-3 py-3 text-right text-slate-700">{callDuration(c.duration_s)}</td>
                    <td className="ref px-4 py-3 text-right text-xs text-slate-500">{ago(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Drawer
        open={!!selected}
        onClose={() => open(null)}
        width="max-w-2xl"
        title={selected && (
          <>
            <p className="text-xs font-medium text-slate-500"><span className="ref text-slate-700">Call {selected.id}</span> · placed {clock(selected.created_at)}</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{selected.name || 'Unknown'}{selected.business_name && ` · ${selected.business_name}`}</h2>
          </>
        )}
        subtitle={selected && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <CallStatusBadge status={selected.status} />
            <span className="ref">{selected.phone}</span>
          </div>
        )}
      >
        {selected && <CallDetail c={selected} refresh={refresh} />}
      </Drawer>

      <NewCall refresh={refresh} open={placing} onClose={() => setPlacing(false)} onPlaced={(c) => { setPlacing(false); open(c) }} />
    </div>
  )
}

/** Labels for the extracted fields, in reading order. Missing ones are skipped. */
const FIELDS: [keyof CallExtraction, string][] = [
  ['contact_name_captured', 'Name'],
  ['business_name_captured', 'Business'],
  ['business_type', 'Business type'],
  ['city', 'City'],
  ['need', 'Need'],
  ['need_details', 'Need, in detail'],
  ['current_setup', 'Current setup'],
  ['monthly_volume', 'Monthly volume'],
  ['budget_inr', 'Budget'],
  ['start_when', 'Wants to start'],
  ['is_decision_maker', 'Decision maker'],
  ['meeting_time', 'Meeting'],
  ['email', 'Email'],
  ['whatsapp_ok', 'WhatsApp OK'],
  ['objections', 'Objections'],
  ['score_reason', 'Why this score'],
]

const pretty = (v: unknown): ReactNode => {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string') return v.replace(/_/g, ' ')
  return String(v)
}

function CallDetail({ c, refresh }: { c: Call; refresh: () => Promise<void> }) {
  const { toast } = useApp()
  const [syncing, setSyncing] = useState(false)
  const sync = async () => {
    setSyncing(true)
    try {
      await api.syncCall(c.id)
      await refresh()
      toast({ title: 'Call result refreshed', desc: 'Fetched the latest from Sarvam.' })
    } catch (e) {
      toast({ tone: 'neutral', title: 'Couldn’t refresh the call', desc: errorText(e) })
    } finally {
      setSyncing(false)
    }
  }
  const x = c.extracted ?? {}
  const fields = FIELDS.filter(([k]) => x[k] != null && x[k] !== '' && x[k] !== 'not_discussed')
  const summary = c.summary || x.call_summary

  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Status" value={CALL_STATUS[c.status]?.label ?? c.status} />
        <Stat label="Outcome" value={c.outcome ? CALL_OUTCOME[c.outcome] ?? c.outcome : '—'} />
        <Stat label="Lead score" value={c.lead_score ?? '—'} />
        <Stat label="Duration" value={callDuration(c.duration_s)} />
      </div>

      {c.error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{c.error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={syncing ? Loader2 : RefreshCw} className={syncing ? '[&>svg]:animate-spin' : ''} onClick={sync} disabled={syncing}>
          {syncing ? 'Refreshing' : 'Refresh result'}
        </Button>
        {c.deal_id != null && (
          <Link to={`/leads?id=${c.deal_id}`} className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium text-slate-600 hover:bg-ink/[0.06] hover:text-slate-950">
            Lead <span className="ref">{c.deal_id}</span><ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        )}
        <span className="ml-auto text-xs text-slate-500">Updated {ago(c.updated_at)}</span>
      </div>

      <section>
        <SectionTitle>Summary</SectionTitle>
        {summary
          ? <p className="rounded-xl bg-ink/[0.03] p-4 text-sm leading-relaxed text-slate-800">{summary}</p>
          : <p className="text-sm text-slate-500">{isLive(c) ? 'The call is still going. The summary arrives when it ends.' : 'No summary for this call. Try Refresh result.'}</p>}
      </section>

      <section>
        <SectionTitle>What Aria learned</SectionTitle>
        {fields.length ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {fields.map(([k, label]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className={cn('mt-0.5 text-slate-900', k === 'budget_inr' && 'ref')}>{k === 'budget_inr' ? rupees(x.budget_inr) : pretty(x[k])}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-sm text-slate-500">Nothing extracted yet.</p>}
      </section>

      <section>
        <SectionTitle>Transcript</SectionTitle>
        {c.transcript?.length ? (
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            {c.transcript.map((m, i) => {
              const aria = m.role === 'agent'
              return (
                <div key={i} className={cn('flex gap-2', aria && 'flex-row-reverse')}>
                  <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', aria ? 'bg-brand-500 text-canvas' : 'bg-slate-200 text-slate-600')}>
                    {aria ? <ResolveAIGlyph className="size-4" /> : <UserRound className="size-3.5" />}
                  </span>
                  <p className={cn('max-w-[78%] rounded-2xl px-3.5 py-2 text-sm text-slate-800 ring-1', aria ? 'rounded-tr-sm bg-surface ring-slate-200' : 'rounded-tl-sm bg-ink/[0.03] ring-slate-200/70')}>{m.text}</p>
                </div>
              )
            })}
          </div>
        ) : <p className="text-sm text-slate-500">No transcript yet.</p>}
      </section>
    </div>
  )
}

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="rounded-lg border border-slate-200 px-3 py-2.5">
    <p className="text-[11px] text-slate-500">{label}</p>
    <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
  </div>
)

const E164_IN = /^\+91[6-9]\d{9}$/
const inputCls = 'h-9 w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-brand-500'

function NewCall({ open, onClose, onPlaced, refresh }: { open: boolean; onClose: () => void; onPlaced: (c: Call) => void; refresh: () => Promise<void> }) {
  const { toast } = useApp()
  const [phone, setPhone] = useState('+91')
  const [name, setName] = useState('')
  const [business, setBusiness] = useState('')
  const [busy, setBusy] = useState(false)
  const number = phone.replace(/[\s-]/g, '')
  const valid = E164_IN.test(number) && name.trim().length > 0

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      const call = await api.placeCall({ phone: number, name: name.trim(), ...(business.trim() ? { business_name: business.trim() } : {}) })
      await refresh()
      toast({ title: `Calling ${name.trim()}`, desc: 'Aria is placing the call now.' })
      setPhone('+91'); setName(''); setBusiness('')
      onPlaced(call)
    } catch (err) {
      toast({ tone: 'neutral', title: 'Couldn’t place the call', desc: errorText(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New call"
      subtitle="Aria's voice agent rings this number, qualifies the lead and logs what it learned."
      footer={<>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" icon={busy ? Loader2 : PhoneCall} className={busy ? '[&>svg]:animate-spin' : ''} disabled={!valid || busy} onClick={() => submit()}>
          {busy ? 'Placing call' : 'Place the call'}
        </Button>
      </>}
    >
      <form onSubmit={submit} className="space-y-4">
        <RealCallWarning />
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Phone number</span>
          <input className={cn(inputCls, 'ref')} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" inputMode="tel" autoComplete="off" />
          <span className={cn('mt-1 block text-xs', number.length > 3 && !E164_IN.test(number) ? 'text-red-700' : 'text-slate-500')}>
            An Indian mobile in E.164 form: +91 and 10 digits.
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Who Aria asks for" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600">Business name <span className="font-normal text-slate-400">(optional)</span></span>
          <input className={inputCls} value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="e.g. Sharma Traders" />
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

