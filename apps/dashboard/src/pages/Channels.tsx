import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Loader2, Radio, KeyRound, ArrowUpRight } from 'lucide-react'
import { api, errorText, live } from '../api'
import { useApp } from '../store'
import { ChannelAccess, CopyButton, INTAKE_URL } from '../components/AgentAccess'
import { Card, PageHeader, Toggle, Badge, Button, Modal, Skeleton, EmptyState } from '../components/ui'
import { channelMeta } from '../meta'
import { cn, num } from '../lib'
import type { ChannelConnection, ChannelId, ChannelOffer } from '../types'

/** "2m 10s" / "38s" → seconds; "—" (no replies yet) → null. */
function seconds(label: string): number | null {
  const m = /^(?:(\d+)m\s*)?(?:(\d+)s)?$/.exec(label.trim())
  if (!m || (!m[1] && !m[2])) return null
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}

/** Where customer messages come in, live from the platform's channels (rai_channels). */
export default function Channels() {
  const { toast } = useApp()
  const { data, error, refresh } = live.useChannels()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Bumped after a change here, so the access panel below re-fetches at once.
  const [version, setVersion] = useState(0)

  const channels = data?.channels ?? []
  const catalog = data?.catalog ?? []

  const toggle = async (c: ChannelConnection, enabled: boolean) => {
    setBusy(c.id)
    try {
      await api.setChannelEnabled(c.id, enabled)
      await refresh()
      setVersion((v) => v + 1)
      toast({ tone: enabled ? 'success' : 'neutral', title: `${c.name} ${enabled ? 'resumed' : 'paused'}`, desc: enabled ? 'Aria is answering here again.' : 'Requests from this channel are refused until you turn it back on.' })
    } catch (e) {
      toast({ tone: 'neutral', title: `Couldn’t change ${c.name}`, desc: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const active = channels.filter((c) => c.enabled)
  const today = active.reduce((a, c) => a + c.messagesToday, 0)
  const fastest = active
    .map((c) => ({ c, s: seconds(c.avgResponse) }))
    .filter((x): x is { c: ChannelConnection; s: number } => x.s != null)
    .sort((a, b) => a.s - b.s)[0]

  return (
    <div>
      <PageHeader
        title="Channels"
        description="Where customer requests come in. Each channel sends them to Aria with its own token; pause one and Aria stops taking its requests."
        actions={catalog.length > 0 && <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add channel</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-6 rounded-xl border border-slate-200/80 bg-surface px-5 py-4 text-sm">
        <div><p className="text-xs text-slate-500">Active channels</p><p className="ref mt-0.5 text-lg font-semibold">{data ? `${active.length} of ${channels.length}` : '–'}</p></div>
        <div><p className="text-xs text-slate-500">Requests today</p><p className="ref mt-0.5 text-lg font-semibold">{data ? num(today) : '–'}</p></div>
        <div>
          <p className="text-xs text-slate-500">Fastest avg. first reply</p>
          <p className="mt-0.5 text-lg font-semibold">
            {fastest ? <><span className="ref">{fastest.c.avgResponse}</span> <span className="text-sm font-normal text-slate-500">· {fastest.c.name}</span></> : <span className="ref">—</span>}
          </p>
        </div>
      </div>

      {!data && error && <Card className="mb-6"><EmptyState icon={Radio} title="Channels aren't available" text={`The demo API didn't return them: ${error}`} /></Card>}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!data && !error && Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-56 p-5"><Skeleton className="size-11" /><Skeleton className="mt-4 h-4 w-28" /></Card>)}
        {channels.map((c) => {
          const l = channelMeta(c.kind)
          return (
            <Card key={c.id} className={cn('flex flex-col p-5 transition-colors', !c.enabled && 'bg-slate-50/60')}>
              <div className="flex items-start justify-between">
                <span className={cn('grid size-11 place-items-center rounded-xl transition', l.tile, !c.enabled && 'opacity-50')}><l.icon className="size-5" /></span>
                {busy === c.id ? <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Saving" /> : <Toggle checked={c.enabled} onChange={(v) => toggle(c, v)} label={`Turn ${c.name} on or off`} />}
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{c.name}</h3>
              <p className="text-sm text-slate-500">{c.desc || l.label}</p>
              <p className="mt-1 truncate text-xs text-slate-400" title={c.handle}>{c.handle}</p>
              <div className="mt-auto pt-4">
                <div className="mb-3 flex items-center gap-2">
                  {!c.enabled
                    ? <Badge className="bg-slate-100 text-slate-600 ring-slate-200" dot="bg-slate-400">Paused</Badge>
                    : c.connected
                      ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200" dot="bg-emerald-500">Connected</Badge>
                      : <Badge className="bg-amber-50 text-amber-800 ring-amber-200" dot="bg-amber-500">Needs a token</Badge>}
                  {c.kind === 'voice' && (
                    <Link to="/calls" className="ml-auto inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-ink/[0.05] hover:text-slate-950">Calls<ArrowUpRight className="size-3" aria-hidden /></Link>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                  <div><p className="text-[11px] text-slate-500">{c.kind === 'voice' ? 'Calls today' : 'Requests today'}</p><p className="ref text-sm font-semibold">{num(c.messagesToday)}</p></div>
                  <div><p className="text-[11px] text-slate-500">Avg. first reply</p><p className="ref text-sm font-semibold">{c.avgResponse || '—'}</p></div>
                </div>
              </div>
            </Card>
          )
        })}
        {data && catalog.length > 0 && (
          <button
            onClick={() => setAdding(true)}
            className="group flex min-h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-ink/[0.02] hover:text-slate-800"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-slate-100 transition group-hover:bg-surface"><Plus className="size-5" /></span>
            <span className="text-sm font-medium">Add channel</span>
          </button>
        )}
      </div>

      {/* Tokens and the intake URL. The cards above hold the on/off switch, so the panel doesn't repeat it. */}
      <ChannelAccess refreshKey={version} onChange={() => void refresh()} toggles={false} />

      <AddChannel open={adding} onClose={() => setAdding(false)} catalog={catalog} onAdded={() => { void refresh(); setVersion((v) => v + 1) }} />
    </div>
  )
}

function AddChannel({ open, onClose, catalog, onAdded }: { open: boolean; onClose: () => void; catalog: ChannelOffer[]; onAdded: () => void }) {
  const { toast } = useApp()
  const [kind, setKind] = useState<ChannelOffer | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ channel: ChannelConnection; token: string } | null>(null)

  const close = () => { setKind(null); setName(''); setCreated(null); onClose() }
  const pick = (o: ChannelOffer) => { setKind(o); setName(o.name) }
  const create = async () => {
    if (!kind || !name.trim()) return
    setBusy(true)
    try {
      const res = await api.createChannel(name.trim(), kind.id as ChannelId)
      setCreated(res)
      onAdded()
      toast({ title: `${res.channel.name} added`, desc: 'Copy its token now; it is only shown once.' })
    } catch (e) {
      toast({ tone: 'neutral', title: 'Couldn’t add the channel', desc: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? `${created.channel.name} is ready` : 'Add a channel'}
      subtitle={created ? 'Send requests to the intake URL with this token.' : 'Another place customers reach you. It gets its own token for the agent intake.'}
      footer={created
        ? <Button variant="primary" onClick={close}>Done</Button>
        : <>
            <Button onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="primary" icon={busy ? Loader2 : Plus} className={busy ? '[&>svg]:animate-spin' : ''} disabled={!kind || !name.trim() || busy} onClick={create}>
              {busy ? 'Adding' : 'Add channel'}
            </Button>
          </>}
    >
      {created ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <KeyRound className="mt-px size-3.5 shrink-0" aria-hidden />Copy the token now: it won’t be shown again. You can make a new one later under Agent intake.
          </p>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Token</p>
            <div className="flex items-center gap-2">
              <code className="ref min-w-0 flex-1 truncate rounded-md border border-ink/10 bg-ink/[0.03] px-2 py-1.5 text-xs text-slate-800">{created.token}</code>
              <CopyButton text={created.token} />
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">Intake URL</p>
            <div className="flex items-center gap-2">
              <code className="ref min-w-0 flex-1 truncate rounded-md border border-ink/10 bg-ink/[0.03] px-2 py-1.5 text-xs text-slate-800">{INTAKE_URL}</code>
              <CopyButton text={INTAKE_URL} />
            </div>
          </div>
          <p className="text-xs text-slate-500">The channel sends <span className="ref">Authorization: Bearer &lt;token&gt;</span> with each request.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-2">
            {catalog.map((o) => {
              const l = channelMeta(o.id)
              const on = kind?.id === o.id
              return (
                <li key={o.id}>
                  <button
                    onClick={() => pick(o)}
                    aria-pressed={on}
                    className={cn('flex w-full cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition', on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300')}
                  >
                    <span className={cn('grid size-10 place-items-center rounded-lg', l.tile)}><l.icon className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-900">{o.name}</span>
                      <span className="block text-xs text-slate-500">{o.desc}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {kind && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">Name</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} className="h-9 w-full rounded-lg border border-slate-200 bg-surface px-3 text-sm text-slate-900 outline-none focus:border-brand-500" />
            </label>
          )}
        </div>
      )}
    </Modal>
  )
}
