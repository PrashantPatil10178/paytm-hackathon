import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, MessageCircle, MessagesSquare, CheckCircle2, ScrollText, UserRound } from 'lucide-react'
import { ResolveAIGlyph } from '@ph/shared/brand'
import { useApp } from '../store'
import { Card, PageHeader, Tabs, LevelBadge, ChannelTag, Drawer, Button, EmptyState, SectionTitle, Badge } from '../components/ui'
import Trace from '../components/Trace'
import ToolChain from '../components/ToolChain'
import { ago, clock, cn, duration, SHOP_URL, hostOf } from '../lib'
import type { Conversation } from '../types'

// Chats Aria answered herself, straight in the chat, without opening a Zendesk ticket: where-is-my-order,
// delivery and policy questions, "which order?" questions and follow-ups on those answers. If a chat later
// needs a person, the ticket is opened then and it shows under Tickets instead.

type Kind = 'all' | 'request' | 'status_check'

export default function Conversations() {
  const { conversations, loading } = useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')

  const base = useMemo(() => {
    const s = q.trim().toLowerCase()
    return conversations.filter((c) => !s || c.id.toLowerCase().includes(s) || c.customer.name.toLowerCase().includes(s) || c.issue.toLowerCase().includes(s))
  }, [conversations, q])
  const rows = kind === 'all' ? base : base.filter((c) => c.kind === kind)
  const selected = conversations.find((c) => c.id === params.get('id'))
  const open = (c: Conversation) => setParams({ id: c.id })

  return (
    <div>
      <PageHeader
        title="Conversations"
        description="Questions Aria answered herself, right in the chat, with no ticket needed. Anything that needs a person gets a ticket instead."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <Tabs
            value={kind}
            onChange={setKind}
            tabs={[
              { value: 'all', label: 'All', count: base.length },
              { value: 'request', label: 'Questions', count: base.filter((c) => c.kind === 'request').length },
              { value: 'status_check', label: 'Follow-ups', count: base.filter((c) => c.kind === 'status_check').length },
            ]}
          />
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" placeholder="ID, customer or question" className="h-8 w-56 rounded-full border border-ink/10 bg-ink/[0.03] pr-3 pl-9 text-[13px] outline-none placeholder:text-slate-400 hover:border-ink/15 focus:border-brand-500 focus:ring-3 focus:ring-brand-500/15" />
          </div>
        </div>

        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                <th className="px-5 py-3 font-medium">Chat</th>
                <th className="px-3 py-3 font-medium">Customer</th>
                <th className="w-full px-3 py-3 font-medium">Question and Aria's answer</th>
                <th className="px-3 py-3 font-medium">Level</th>
                <th className="px-5 py-3 font-medium whitespace-nowrap">Answered in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => (
                <tr key={c.id} onClick={() => open(c)} className={cn('cursor-pointer transition hover:bg-slate-50', selected?.id === c.id && 'bg-brand-50/40')}>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="ref block font-medium text-slate-900">{c.id}</span>
                    <span className="block text-xs text-slate-500">{ago(c.createdAt)}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="flex items-center gap-2 font-medium text-slate-800">{c.customer.name}<ChannelTag channel={c.channel} compact /></span>
                    <span className="block text-xs text-slate-500">{c.customer.city || '—'}</span>
                  </td>
                  <td className="max-w-0 px-3 py-3">
                    <span className="block truncate text-slate-800" title={c.issue}>{c.issue}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500" title={c.result}>{c.result}</span>
                    <ToolChain steps={c.steps} max={7} className="mt-1.5" />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{c.level ? <LevelBadge level={c.level} /> : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className="ref px-5 py-3 text-xs whitespace-nowrap text-slate-600">{duration(c.createdAt, c.answeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && conversations.length === 0 && (
            <EmptyState
              icon={MessagesSquare}
              title="No conversations yet"
              text={<>Ask "where is my order?" in the ShopKart chat (<a className="ref text-slate-700 underline-offset-2 hover:underline" href={SHOP_URL} target="_blank" rel="noreferrer">{hostOf(SHOP_URL)}</a>): Aria answers it straight away, with no ticket, and it shows up here.</>}
            />
          )}
          {conversations.length > 0 && rows.length === 0 && <EmptyState icon={MessagesSquare} title="No conversations match" text="Try clearing the search." />}
        </div>
      </Card>

      <Drawer
        open={!!selected}
        onClose={() => setParams({})}
        width="max-w-2xl"
        title={selected && (
          <>
            <p className="text-xs font-medium text-slate-500"><span className="ref text-slate-700">{selected.id}</span> · {clock(selected.createdAt)}</p>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">{selected.issue}</h2>
          </>
        )}
        subtitle={selected && (
          <div className="flex flex-wrap items-center gap-2">
            {selected.level && <LevelBadge level={selected.level} />}
            <Badge className="bg-brand-50 text-brand-700 ring-brand-100">No ticket</Badge>
            <ChannelTag channel={selected.channel} />
          </div>
        )}
      >
        {selected && <ConversationDetail c={selected} onAudit={() => navigate(`/audit?ref=${selected.id}`)} onChat={() => navigate(`/chats?id=${encodeURIComponent(selected.sessionId)}`)} />}
      </Drawer>
    </div>
  )
}

function ConversationDetail({ c, onAudit, onChat }: { c: Conversation; onAudit: () => void; onChat: () => void }) {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start gap-3 rounded-xl bg-brand-50/70 p-4 ring-1 ring-brand-100">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-600" />
        <div>
          <p className="text-sm font-semibold text-slate-900">Answered by the AI in {duration(c.createdAt, c.answeredAt)}</p>
          {c.summary && <p className="mt-0.5 text-sm text-slate-700">{c.summary}</p>}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <Field label="Customer" value={c.customer.name} />
        <Field label="Contact" value={c.customer.contact || '—'} />
        <Field label="City" value={c.customer.city || '—'} />
        <Field label="Kind" value={c.kind === 'status_check' ? 'Follow-up' : 'Question'} />
        <Field label="Helpdesk" value="No ticket" />
      </dl>

      <section>
        <SectionTitle>Conversation</SectionTitle>
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          {c.conversation.map((m, i) => {
            const mine = m.from !== 'customer'
            return (
              <div key={i} className={cn('flex gap-2', mine && 'flex-row-reverse')}>
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold', m.from === 'customer' ? 'bg-slate-200 text-slate-600' : 'bg-brand-500 text-canvas')}>
                  {m.from === 'customer' ? (c.customer.name[0] ?? '?') : m.from === 'ai' ? <ResolveAIGlyph className="size-4" /> : <UserRound className="size-3.5" />}
                </span>
                <div className={cn('max-w-[78%] rounded-2xl px-3.5 py-2 text-sm', mine ? 'rounded-tr-sm bg-surface shadow-sm ring-1 ring-slate-200' : 'rounded-tl-sm bg-ink/[0.03] ring-1 ring-slate-200/70')}>
                  <p className="whitespace-pre-line text-slate-800">{m.text}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{m.from === 'customer' ? c.customer.name : 'Aria (AI)'} · {clock(m.time)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <SectionTitle action={<button onClick={onAudit} className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"><ScrollText className="size-3.5" aria-hidden />Open in audit log</button>}>
          What the agent did
        </SectionTitle>
        <ToolChain steps={c.steps} size="md" className="mb-5 flex-wrap gap-y-2" />
        <Trace steps={c.steps} />
      </section>

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <Button onClick={onChat} icon={MessageCircle} variant="primary">Open the chat</Button>
        <Button onClick={onAudit} icon={ScrollText}>Full audit trail</Button>
      </div>
    </div>
  )
}

const Field = ({ label, value }: { label: string; value: ReactNode }) => (
  <div>
    <dt className="text-xs text-slate-500">{label}</dt>
    <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
  </div>
)
