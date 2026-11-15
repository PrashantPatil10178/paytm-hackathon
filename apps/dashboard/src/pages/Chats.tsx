import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, CircleDot, MessageCircle, Search, SendHorizontal, Ticket as TicketIcon, Undo2, UserRound } from 'lucide-react'
import { OWNER, type ChatMessage } from '@ph/shared'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { api, live } from '../api'
import { useApp } from '../store'
import { Badge, Button, ChannelTag, EmptyState, PageHeader, Skeleton, Tabs } from '../components/ui'
import { ago, clock, cn, hostOf, initials, SHOP_URL } from '../lib'
import type { ChatThread } from '../types'

// The live chat inbox: every ShopKart chat, with or without a ticket. Aria answers until you reply here; your
// first reply takes the chat over (its ticket, opened now if it has none, is assigned to you) and Aria stays
// quiet while you talk. Hand it back, or mark it solved, when you're done. The customer sees your messages in
// the shop's chat widget, and they show on the Zendesk ticket as your replies.

type Filter = 'all' | 'yours' | 'aria'

export default function Chats() {
  const { data, error } = live.useChats()
  const chats = data?.chats
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const base = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (chats ?? []).filter((c) => !s || c.customer.name.toLowerCase().includes(s) || c.last?.body.toLowerCase().includes(s) || String(c.ticket?.id ?? '').includes(s.replace('#', '')))
  }, [chats, q])
  const rows = filter === 'all' ? base : base.filter((c) => (filter === 'yours' ? c.handler === 'human' : c.handler === 'ai'))
  const id = params.get('id')
  const selected = chats?.find((c) => c.id === id) ?? null
  const select = (c: ChatThread | null) => setParams(c ? { id: c.id } : {}, { replace: true })

  // On a wide screen, open the newest chat rather than an empty pane.
  useEffect(() => {
    if (!id && rows[0] && matchMedia('(min-width: 1024px)').matches) select(rows[0])
    // only when nothing is selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, rows[0]?.id])

  const waiting = base.filter((c) => c.waiting).length

  return (
    <div>
      <PageHeader
        title="Chats"
        description="Every ShopKart chat, live. Aria answers until you reply: then the chat is yours and she stays quiet until you hand it back."
        actions={waiting > 0 && <Badge className="bg-amber-50 text-amber-700 ring-amber-200" dot="bg-amber-500">{waiting} waiting on you</Badge>}
      />

      <div className="grid h-[calc(100dvh-12.5rem)] min-h-[520px] overflow-hidden rounded-2xl border border-ink/[0.06] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04)] lg:grid-cols-[minmax(300px,360px)_1fr]">
        {/* Inbox */}
        <section aria-label="Chats" className={cn('flex min-h-0 flex-col border-ink/[0.07] lg:border-r', selected && 'max-lg:hidden')}>
          <div className="space-y-3 border-b border-ink/[0.07] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" placeholder="Customer, message or ticket #" className="h-8 w-full rounded-full border border-ink/10 bg-ink/[0.03] pr-3 pl-9 text-[13px] outline-none placeholder:text-slate-400 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15" />
            </div>
            <Tabs
              value={filter}
              onChange={setFilter}
              tabs={[
                { value: 'all', label: 'All', count: base.length },
                { value: 'yours', label: 'With you', count: base.filter((c) => c.handler === 'human').length },
                { value: 'aria', label: 'With Aria', count: base.filter((c) => c.handler === 'ai').length },
              ]}
            />
          </div>
          <ul className="scrollbar-thin min-h-0 flex-1 divide-y divide-ink/[0.05] overflow-y-auto">
            {!chats && !error && [0, 1, 2, 3].map((i) => (
              <li key={i} className="flex gap-3 p-3"><Skeleton className="size-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-full" /></div></li>
            ))}
            {rows.map((c) => <ChatRow key={c.id} c={c} active={c.id === selected?.id} onSelect={() => select(c)} />)}
          </ul>
          {chats && chats.length === 0 && (
            <EmptyState
              icon={MessageCircle}
              title="No chats yet"
              text={<>Chats appear here as customers write in the ShopKart chat (<a className="ref text-slate-700 underline-offset-2 hover:underline" href={SHOP_URL} target="_blank" rel="noreferrer">{hostOf(SHOP_URL)}</a>). Reply to any of them to take it over from Aria.</>}
            />
          )}
          {chats && chats.length > 0 && rows.length === 0 && <EmptyState icon={MessageCircle} title="No chats match" text="Try another filter or clear the search." />}
        </section>

        {/* Conversation */}
        <section aria-label="Conversation" className={cn('flex min-h-0 flex-col', !selected && 'max-lg:hidden')}>
          {selected ? (
            <ChatPane key={selected.id} thread={selected} onBack={() => select(null)} />
          ) : (
            <div className="grid flex-1 place-items-center p-8">
              <EmptyState icon={MessageCircle} title="Pick a chat" text="Its messages show here, live. Write a reply to take it over from Aria." />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-full bg-ink/[0.06] text-xs font-semibold text-slate-600', className)} aria-hidden>{initials(name)}</span>
}

/** Who is answering: Aria (mint) or a person (periwinkle). */
function HandlerChip({ c }: { c: ChatThread }) {
  return c.handler === 'human' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-human/10 px-1.5 py-0.5 text-[11px] font-medium text-human">
      <UserRound className="size-3" aria-hidden />{c.agent === OWNER.name ? 'You' : c.agent}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
      <ResolveAIGlyph className="size-3" />Aria
    </span>
  )
}

const lastPrefix = (c: ChatThread) => {
  if (!c.last || c.last.sender === 'customer') return ''
  if (c.last.sender === 'ai') return 'Aria: '
  return c.last.author === OWNER.name ? 'You: ' : `${c.last.author.split(' ')[0]}: `
}

function ChatRow({ c, active, onSelect }: { c: ChatThread; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" onClick={onSelect} aria-current={active || undefined} className={cn('flex w-full cursor-pointer gap-3 p-3 text-left transition-colors hover:bg-ink/[0.03]', active && 'bg-ink/[0.04] hover:bg-ink/[0.05]')}>
        <span className="relative">
          <Avatar name={c.customer.name} />
          {c.waiting && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-surface" aria-label="Waiting on a reply" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('min-w-0 flex-1 truncate text-[13px] text-slate-900', c.waiting ? 'font-semibold' : 'font-medium')}>{c.customer.name}</span>
            <span className="ref shrink-0 text-[11px] text-slate-400">{ago(c.updatedAt)}</span>
          </span>
          <span className={cn('mt-0.5 block truncate text-xs', c.waiting ? 'text-slate-800' : 'text-slate-500')}>
            {lastPrefix(c)}{c.last?.body ?? '—'}
          </span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <HandlerChip c={c} />
            {c.ticket && (
              <span className={cn('ref inline-flex items-center gap-1 text-[11px]', c.ticket.status === 'solved' ? 'text-slate-400' : 'text-slate-600')}>
                <TicketIcon className="size-3" aria-hidden />#{c.ticket.id}{c.ticket.status === 'solved' && ' · solved'}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}

function ChatPane({ thread, onBack }: { thread: ChatThread; onBack: () => void }) {
  const { toast } = useApp()
  const poll = live.useChat(thread.id)
  const messages = poll.data?.messages
  const c = poll.data?.chat ?? thread
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState<'handback' | 'solve' | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const first = c.customer.name.split(' ')[0]
  const mine = c.handler === 'human' && c.agent === OWNER.name

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [messages?.length, pending])

  const send = async () => {
    const text = draft.trim()
    if (!text || pending) return
    setPending(text)
    setDraft('')
    try {
      await api.sendChatMessage(c.id, text)
      await poll.refresh()
    } catch (e) {
      setDraft(text)
      toast({ tone: 'neutral', title: "Couldn't send that", desc: (e as Error).message })
    } finally {
      setPending(null)
      input.current?.focus()
    }
  }

  const act = async (what: 'handback' | 'solve') => {
    setBusy(what)
    try {
      await (what === 'handback' ? api.handBackChat(c.id) : api.solveChat(c.id))
      await poll.refresh()
      toast({ tone: 'success', title: what === 'handback' ? 'Aria has the chat again' : `Ticket #${c.ticket?.id} solved`, desc: what === 'handback' ? `She answers ${first}'s next message.` : `A new message from ${first} starts fresh with Aria.` })
    } catch (e) {
      toast({ tone: 'neutral', title: what === 'handback' ? "Couldn't hand it back" : "Couldn't solve it", desc: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/[0.07] px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Back to chats" className="grid size-8 cursor-pointer place-items-center rounded-lg text-slate-500 hover:bg-ink/[0.06] hover:text-slate-950 lg:hidden">
          <ArrowLeft className="size-4" />
        </button>
        <Avatar name={c.customer.name} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-950">{c.customer.name}<ChannelTag channel={c.channel} compact /></p>
          <p className="truncate text-xs text-slate-500">{[c.customer.contact, c.customer.city].filter(Boolean).join(' · ') || '—'} · started {ago(c.startedAt)}</p>
        </div>
        {c.ticket && (
          <Link to={`/tickets?id=${c.ticket.id}`} className="ref inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-2.5 py-1 text-xs text-slate-700 hover:border-ink/15 hover:bg-ink/[0.04]" title={c.ticket.subject}>
            <TicketIcon className="size-3.5" aria-hidden />#{c.ticket.id}<span className="text-slate-400">{c.ticket.status}</span>
          </Link>
        )}
        {c.handler === 'human' && (
          <Button size="sm" icon={Undo2} disabled={!!busy} onClick={() => act('handback')}>{busy === 'handback' ? 'Handing back…' : 'Hand back to Aria'}</Button>
        )}
        {c.ticket && c.ticket.status !== 'solved' && (
          <Button size="sm" icon={CheckCircle2} disabled={!!busy} onClick={() => act('solve')}>{busy === 'solve' ? 'Solving…' : 'Mark solved'}</Button>
        )}
      </header>

      <div className={cn('flex items-center gap-2 px-4 py-2 text-xs', c.handler === 'human' ? 'bg-human/[0.07] text-human' : 'bg-brand-50 text-brand-700')} role="status">
        {c.handler === 'human' ? <UserRound className="size-3.5 shrink-0" aria-hidden /> : <ResolveAIGlyph className="size-3.5 shrink-0" />}
        {c.handler === 'human'
          ? mine
            ? <span>You're on this chat. Aria stays quiet; {first}'s messages come to you{c.waiting ? ' and they are waiting on a reply' : ''}.</span>
            : <span>{c.agent} has this chat. Replying takes it over.</span>
          : <span>Aria is answering this chat. Your reply takes it over{c.ticket && c.ticket.status !== 'solved' ? ` and assigns #${c.ticket.id} to you` : ' and opens a ticket for it'}.</span>}
      </div>

      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto bg-ink/[0.015] px-4 py-4" role="log" aria-live="polite" aria-label={`Chat with ${c.customer.name}`}>
        {!messages && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className={cn('h-12 rounded-2xl', i % 2 ? 'ml-auto w-1/2' : 'w-2/3')} />)}</div>}
        {messages?.map((m, i) => <Line key={m.id} m={m} prev={messages[i - 1]} customer={c.customer.name} />)}
        {pending && (
          <div className="flex justify-end opacity-60">
            <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-human/10 px-3.5 py-2 text-sm text-slate-900 ring-1 ring-human/20">
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{pending}</p>
              <p className="mt-1 text-right text-[11px] text-slate-500">Sending…</p>
            </div>
          </div>
        )}
      </div>

      <form
        className="border-t border-ink/[0.07] p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-ink/10 bg-canvas p-1.5 pl-3.5 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15">
          <label htmlFor="chat-reply" className="sr-only">Reply to {c.customer.name}</label>
          <textarea
            id="chat-reply"
            ref={input}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            maxLength={4000}
            placeholder={`Reply to ${first}…`}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <Button type="submit" variant="primary" icon={SendHorizontal} disabled={!draft.trim() || !!pending} aria-label="Send reply">Send</Button>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
          <CircleDot className="size-3" aria-hidden />
          {first} sees this in the ShopKart chat{c.ticket ? `, and it goes on ticket #${c.ticket.id}` : ''}. Enter sends, Shift+Enter adds a line.
        </p>
      </form>
    </>
  )
}

function Line({ m, prev, customer }: { m: ChatMessage; prev?: ChatMessage; customer: string }) {
  if (m.sender === 'system')
    return (
      <p className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1 text-[11px] font-medium text-slate-600">
        {m.body.startsWith('Ticket') ? <TicketIcon className="size-3" aria-hidden /> : <UserRound className="size-3" aria-hidden />}
        {m.body}
      </p>
    )
  const theirs = m.sender === 'customer'
  const first = prev?.sender !== m.sender || prev?.author !== m.author
  const who = theirs ? customer : m.sender === 'ai' ? 'Aria' : m.author === OWNER.name ? `You (${m.author})` : m.author
  return (
    <div className={cn('flex items-end gap-2', !theirs && 'flex-row-reverse', first && 'pt-2')}>
      {first ? (
        theirs ? <Avatar name={customer} className="size-7 text-[10px]" />
        : m.sender === 'ai' ? <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-500 text-canvas" aria-hidden><ResolveAIGlyph className="size-4" /></span>
        : <span className="grid size-7 shrink-0 place-items-center rounded-full bg-human/15 text-[10px] font-semibold text-human" aria-hidden>{initials(m.author)}</span>
      ) : <span className="w-7 shrink-0" aria-hidden />}
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm text-slate-900 ring-1',
          theirs ? 'rounded-bl-sm bg-surface ring-slate-200' : m.sender === 'ai' ? 'rounded-br-sm bg-brand-50 ring-brand-100' : 'rounded-br-sm bg-human/10 ring-human/20',
        )}
      >
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{m.body}</p>
        {m.ask && (
          <div className="mt-2 rounded-xl bg-surface/70 p-2 ring-1 ring-ink/[0.06]">
            <p className="text-xs font-medium text-slate-700">{m.ask.prompt}</p>
            <ul className="mt-1 space-y-0.5">
              {m.ask.choices.map((ch) => <li key={ch.value} className="truncate text-xs text-slate-500">{ch.label} <span className="ref">#{ch.value}</span></li>)}
            </ul>
          </div>
        )}
        {m.answer && <p className="mt-1 text-[11px] text-slate-500">Picked from Aria's question</p>}
        <p className={cn('mt-1 text-[11px] text-slate-500', !theirs && 'text-right')}>{who} · <span className="ref">{clock(m.created_at)}</span></p>
      </div>
    </div>
  )
}
