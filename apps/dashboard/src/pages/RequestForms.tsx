import { useState } from 'react'
import { ArrowUpRight, Camera, ClipboardList, ListChecks, Package, Send, SendHorizontal, Type, Undo2 } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { BOT, SUPPORT_AGENTS, type InfoFieldKind, type InfoForm, type InfoRequest, type TicketSummary, type UpdateInfoFormBody } from '@ph/shared'
import { api, live } from '../api'
import { useApp } from '../store'
import { Panel, PageHeader, Badge, Button, EmptyState, Modal, Select, Skeleton, Toggle } from '../components/ui'
import { ago, cn, initials } from '../lib'
import type { Icon } from '../meta'

// The Zendesk look-alike, where the tickets live (ticket pages at /tickets/:id).
const ZENDESK_URL: string = import.meta.env.VITE_ZENDESK_URL || 'http://localhost:3001'

const KIND: Record<InfoFieldKind, { icon: Icon; label: string }> = {
  order: { icon: Package, label: 'Pick an order' },
  choice: { icon: ListChecks, label: 'Pick one' },
  text: { icon: Type, label: 'Short answer' },
  photo: { icon: Camera, label: 'Photo' },
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const firstName = (name: string) => name.split(' – ')[0]!.split(' ')[0]!

function TicketLink({ id }: { id: number }) {
  return (
    <a href={`${ZENDESK_URL}/tickets/${id}`} target="_blank" rel="noreferrer" className="ref inline-flex items-center gap-0.5 font-medium text-slate-900 hover:underline">
      #{id}<ArrowUpRight className="size-3" aria-hidden />
    </a>
  )
}

/* ───────── Send a form from a ticket ───────── */

function SendPanel({ forms, tickets }: { forms?: InfoForm[]; tickets?: TicketSummary[] }) {
  const { toast } = useApp()
  // Forms show up in the ShopKart chat, so only chat tickets can get one.
  const chats = tickets?.filter((t) => t.via === 'chat')
  const [ticketId, setTicketId] = useState('')
  const [formId, setFormId] = useState('')
  const [byChoice, setBy] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const ticket = chats?.find((t) => String(t.id) === ticketId) ?? chats?.[0]
  const form = forms?.find((f) => f.id === formId) ?? forms?.[0]
  // Sent as the ticket's owner when a person already has it, unless you pick someone else.
  const owner = ticket?.assignee && (SUPPORT_AGENTS as readonly string[]).includes(ticket.assignee) ? ticket.assignee : SUPPORT_AGENTS[0]
  const by = byChoice ?? owner

  const send = async () => {
    if (!ticket || !form) return
    setSending(true)
    try {
      await api.sendForm({ ticket_id: ticket.id, form_id: form.id, requested_by: by })
      toast({ title: 'Form sent', desc: `"${form.title}" is in ${firstName(ticket.requester.name)}'s chat. Their answers land on ticket #${ticket.id}.` })
    } catch (e) {
      toast({ title: "Couldn't send the form", desc: errorText(e) })
    } finally {
      setSending(false)
    }
  }

  return (
    <Panel icon={SendHorizontal} title="Ask a customer" meta="from a ticket">
      {!forms || !chats ? <div className="p-5"><Skeleton className="h-28" /></div> : !chats.length ? (
        <EmptyState icon={SendHorizontal} title="No open chats" text="Forms appear in the customer’s ShopKart chat. Start a chat there first, then pick its ticket here." />
      ) : (
        <div className="space-y-3 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Ticket</span>
            <Select
              label="Ticket"
              className="w-full"
              value={String(ticket?.id ?? '')}
              onChange={(id) => { setTicketId(id); setBy(null) }}
              options={chats.map((t) => ({ value: String(t.id), label: `#${t.id} · ${t.requester.name} · ${t.subject}` }))}
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Form</span>
              <Select label="Form" className="w-full" value={form?.id ?? ''} onChange={setFormId} options={forms.map((f) => ({ value: f.id, label: f.title }))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Send as</span>
              <Select label="Send as" className="w-full" value={by} onChange={setBy} options={SUPPORT_AGENTS.map((a) => ({ value: a, label: a }))} />
            </label>
          </div>
          {form && (
            <p className="text-xs text-slate-600">
              Asks for {form.fields.filter((f) => f.enabled).map((f) => f.label.replace(/\?$/, '').toLowerCase()).join(', ')}. The ticket goes to pending until they answer.
            </p>
          )}
          <Button variant="primary" icon={Send} disabled={sending || !ticket || !form} onClick={send} className="w-full sm:w-auto">
            {sending ? 'Sending…' : 'Send to chat'}
          </Button>
        </div>
      )}
    </Panel>
  )
}

/* ───────── The forms ───────── */

function FormCard({ form, onSaved }: { form: InfoForm; onSaved: () => Promise<void> }) {
  const { toast } = useApp()
  // null = showing the saved text; a string = an unsaved edit.
  const [draft, setAsk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ask = draft ?? form.ask

  const save = async (changes: UpdateInfoFormBody) => {
    setBusy(true)
    try {
      await api.updateForm(form.id, changes)
      await onSaved()
      if (changes.ask !== undefined) setAsk(null)
    } catch (e) {
      toast({ title: `Couldn't save “${form.title}”`, desc: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  const dirty = draft !== null && draft.trim() !== form.ask
  return (
    <li className={cn('px-4 py-4', busy && 'opacity-70')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-950">{form.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">Aria sends it for: {form.use_for}</p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
          <span className={cn('inline-flex items-center gap-1', form.active && 'text-brand-700')}>
            <ResolveAIGlyph className="size-3.5" />{form.active ? 'Aria can send' : 'Aria can’t send'}
          </span>
          <Toggle checked={form.active} onChange={(active) => save({ active })} label={`Aria can send “${form.title}”`} />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] font-medium text-slate-500">The customer reads</span>
        <textarea
          value={ask}
          maxLength={240}
          rows={2}
          onChange={(e) => setAsk(e.target.value)}
          className="w-full resize-none rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2 text-[13px] text-slate-900 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15 focus:outline-none"
        />
      </label>
      {dirty && (
        <div className="mt-1.5 flex gap-2">
          <Button size="sm" variant="primary" disabled={busy || !ask.trim()} onClick={() => save({ ask: ask.trim() })}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
        </div>
      )}

      <table className="mt-3 w-full text-left text-[13px]">
        <thead className="text-[11px] text-slate-500">
          <tr>
            <th className="pb-1.5 font-medium">Asks for</th>
            <th className="w-14 pb-1.5 text-center font-medium">Ask</th>
            <th className="w-16 pb-1.5 text-center font-medium">Required</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/[0.05] border-t border-ink/[0.06]">
          {form.fields.map((f) => {
            const k = KIND[f.kind]
            return (
              <tr key={f.key} className={cn(!f.enabled && 'text-slate-400')}>
                <td className="py-2 pr-2">
                  <span className="flex items-center gap-2">
                    <k.icon className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                    <span className={cn('font-medium', f.enabled ? 'text-slate-900' : 'text-slate-400')}>{f.label}</span>
                  </span>
                  <span className="ml-5.5 block text-[11px] text-slate-500">{f.options?.length ? f.options.join(' · ') : k.label}</span>
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`Ask for ${f.label}`}
                    checked={f.enabled}
                    disabled={busy}
                    onChange={(e) => save({ fields: [{ key: f.key, enabled: e.target.checked }] })}
                    className="size-4 cursor-pointer accent-slate-900"
                  />
                </td>
                <td className="py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${f.label} is required`}
                    checked={f.enabled && f.required}
                    disabled={busy || !f.enabled}
                    onChange={(e) => save({ fields: [{ key: f.key, required: e.target.checked }] })}
                    className="size-4 cursor-pointer accent-slate-900 disabled:cursor-not-allowed"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </li>
  )
}

function FormsPanel({ forms, onSaved }: { forms?: InfoForm[]; onSaved: () => Promise<void> }) {
  return (
    <Panel icon={ClipboardList} title="Forms" meta={forms && `${forms.filter((f) => f.active).length} of ${forms.length} on for Aria`}>
      {!forms ? <div className="p-4"><Skeleton className="h-40" /></div> : (
        <ul className="divide-y divide-ink/[0.06]">
          {forms.map((f) => <FormCard key={f.id} form={f} onSaved={onSaved} />)}
        </ul>
      )}
    </Panel>
  )
}

/* ───────── Sent forms ───────── */

function Sender({ by }: { by: string }) {
  if (by === BOT) {
    return (
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700" title="Sent by Aria">
        <ResolveAIGlyph className="size-4" />
      </span>
    )
  }
  return (
    <span className="ref grid size-7 shrink-0 place-items-center rounded-full bg-human/12 text-[10px] font-medium text-human" title={`Sent by ${by}`}>
      {initials(by.split(' – ')[0]!)}
    </span>
  )
}

const STATUS: Record<InfoRequest['status'], { label: string; className: string; dot: string }> = {
  waiting: { label: 'Waiting for customer', className: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  answered: { label: 'Answered', className: 'bg-ink/[0.04] text-slate-700 ring-ink/10', dot: 'bg-slate-500' },
  withdrawn: { label: 'Withdrawn', className: 'bg-transparent text-slate-500 ring-ink/10', dot: 'bg-slate-300' },
}

function SentRow({ r, onPhoto }: { r: InfoRequest; onPhoto: (src: string) => void }) {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const s = STATUS[r.status]
  const withdraw = async () => {
    setBusy(true)
    try {
      await api.withdrawForm(r.id)
    } catch (e) {
      toast({ title: "Couldn't withdraw the form", desc: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex gap-3 px-4 py-3.5">
      <Sender by={r.requested_by} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-[13px] text-slate-950">
            <span className="font-medium">{r.title}</span>
            <span className="text-slate-500"> to {r.customer?.name ?? 'customer'}</span>
          </p>
          <Badge className={s.className} dot={s.dot}>{s.label}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {r.requested_by === BOT ? 'Aria' : r.requested_by.split(' – ')[0]} · ticket <TicketLink id={r.ticket_id} /> · {ago(r.answered_at ?? r.created_at)}
        </p>

        {r.answers?.length ? (
          <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-lg border border-ink/[0.07] bg-ink/[0.02] p-2.5 text-[13px] sm:grid-cols-[auto_1fr]">
            {r.answers.map((a) => (
              <div key={a.key} className="contents">
                <dt className="text-slate-500">{a.label.replace(/\?$/, '')}</dt>
                <dd className="min-w-0 text-slate-900">
                  {a.value.startsWith('data:image/') ? (
                    <button type="button" onClick={() => onPhoto(a.value)} className="block cursor-zoom-in" aria-label={`Open ${a.label}`}>
                      <img src={a.value} alt="" className="h-14 rounded-md border border-ink/10 object-cover" />
                    </button>
                  ) : a.text}
                </dd>
              </div>
            ))}
          </dl>
        ) : r.status === 'waiting' ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-600">Asks for {r.fields.map((f) => f.label.replace(/\?$/, '').toLowerCase()).join(', ')}</p>
            <Button size="sm" variant="ghost" icon={Undo2} disabled={busy} onClick={withdraw} className="ml-auto">Withdraw</Button>
          </div>
        ) : null}
      </div>
    </li>
  )
}

function SentPanel({ requests }: { requests?: InfoRequest[] }) {
  const [photo, setPhoto] = useState<string | null>(null)
  const waiting = requests?.filter((r) => r.status === 'waiting').length ?? 0
  return (
    <Panel icon={ClipboardList} title="Sent forms" meta={requests && (waiting ? `${waiting} waiting` : `${requests.length} recent`)}>
      {!requests ? <div className="p-4"><Skeleton className="h-40" /></div> : !requests.length ? (
        <EmptyState icon={ClipboardList} title="No forms sent yet" text="When Aria needs to know which order or what went wrong, she sends a form into the chat. It shows up here, with the answers." />
      ) : (
        <ul className="divide-y divide-ink/[0.05]">
          {requests.map((r) => <SentRow key={r.id} r={r} onPhoto={setPhoto} />)}
        </ul>
      )}
      <Modal open={!!photo} onClose={() => setPhoto(null)} title="Photo from the customer">
        {photo && <img src={photo} alt="Sent by the customer" className="w-full rounded-lg" />}
      </Modal>
    </Panel>
  )
}

/** Support: the details Aria (or a person) asks customers for in the chat, and what they answered. Live from the demo API. */
export default function RequestForms() {
  const forms = live.useInfoForms()
  const requests = live.useInfoRequests().data?.requests
  const tickets = live.useOpenTickets().data?.tickets

  return (
    <div>
      <PageHeader
        title="Request forms"
        description="When it isn’t clear which order a customer means or what went wrong, Aria sends one of these forms into the ShopKart chat instead of guessing. The customer taps their answers; they land on the ticket."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <div className="space-y-4">
          <FormsPanel forms={forms.data?.forms} onSaved={forms.refresh} />
        </div>
        <div className="space-y-4">
          <SendPanel forms={forms.data?.forms} tickets={tickets} />
          <SentPanel requests={requests} />
        </div>
      </div>
    </div>
  )
}
