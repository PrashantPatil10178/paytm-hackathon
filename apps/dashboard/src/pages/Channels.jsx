import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Camera, Send, MessageSquareText, Phone, Loader2, Check, Radio } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { Card, PageHeader, Toggle, Badge, Button, Modal, Skeleton } from '../components/ui'
import { CHANNELS } from '../meta'
import { cn, num } from '../lib'

const EXTRA = {
  instagram: { icon: Camera, tile: 'bg-pink-50 text-pink-600' },
  telegram: { icon: Send, tile: 'bg-sky-50 text-sky-600' },
  sms: { icon: MessageSquareText, tile: 'bg-slate-100 text-slate-600' },
  voice: { icon: Phone, tile: 'bg-indigo-50 text-indigo-600' },
}
const look = (id) => CHANNELS[id] || EXTRA[id]

export default function Channels() {
  const { toast } = useApp()
  const navigate = useNavigate()
  const [channels, setChannels] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [adding, setAdding] = useState(false)
  const [connecting, setConnecting] = useState(null)

  useEffect(() => { api.getChannels().then((d) => { setChannels(d.channels); setCatalog(d.catalog) }) }, [])

  const toggle = (id, enabled) => {
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, enabled } : c)))
    const c = channels.find((x) => x.id === id)
    toast({ tone: enabled ? 'success' : 'neutral', title: `${c.name} ${enabled ? 'resumed' : 'paused'}`, desc: enabled ? 'The agent is answering again.' : 'New messages go straight to your human team.' })
  }

  const connect = async (item) => {
    setConnecting(item.id)
    await api.connect(item.id)
    setChannels((cs) => [...cs, { ...item, handle: 'Just connected', connected: true, enabled: true, messagesToday: 0, avgResponse: '—' }])
    setConnecting(null)
    setAdding(false)
    toast({ title: `${item.name} connected`, desc: 'The agent will start answering here right away.' })
  }

  const totalToday = channels?.filter((c) => c.enabled).reduce((a, c) => a + c.messagesToday, 0) ?? 0
  const available = catalog.filter((c) => !channels?.some((x) => x.id === c.id))

  return (
    <div>
      <PageHeader
        title="Channels"
        description="Where customer messages come in. Turn one on and the agent starts answering there."
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add channel</Button>}
      />

      <div className="mb-5 flex flex-wrap gap-6 rounded-xl border border-slate-200/80 bg-surface px-5 py-4 text-sm">
        <div><p className="text-xs text-slate-500">Active channels</p><p className="mt-0.5 text-lg font-semibold tabular">{channels?.filter((c) => c.enabled).length ?? '–'}</p></div>
        <div><p className="text-xs text-slate-500">Messages today</p><p className="mt-0.5 text-lg font-semibold tabular">{num(totalToday)}</p></div>
        <div><p className="text-xs text-slate-500">Fastest first response</p><p className="mt-0.5 text-lg font-semibold">22s <span className="text-sm font-normal text-slate-500">· Web chat</span></p></div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!channels && Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-56 p-5"><Skeleton className="size-11" /><Skeleton className="mt-4 h-4 w-28" /></Card>)}
        {channels?.map((c) => {
          const l = look(c.id)
          return (
            <Card key={c.id} className={cn('flex flex-col p-5 transition-colors', !c.enabled && 'bg-slate-50/60')}>
              <div className="flex items-start justify-between">
                <span className={cn('grid size-11 place-items-center rounded-xl transition', l.tile, !c.enabled && 'grayscale')}><l.icon className="size-5" /></span>
                <Toggle checked={c.enabled} onChange={(v) => toggle(c.id, v)} label={`Enable ${c.name}`} />
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{c.name}</h3>
              <p className="text-sm text-slate-500">{c.desc}</p>
              <p className="mt-1 truncate text-xs text-slate-400">{c.handle}</p>
              <div className="mt-auto pt-4">
                <div className="mb-3 flex items-center gap-2">
                  {c.enabled
                    ? <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200" dot="bg-emerald-500">Connected</Badge>
                    : <Badge className="bg-slate-100 text-slate-600 ring-slate-200" dot="bg-slate-400">Paused</Badge>}
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                  <div><p className="text-[11px] text-slate-500">Messages today</p><p className="text-sm font-semibold tabular">{num(c.messagesToday)}</p></div>
                  <div><p className="text-[11px] text-slate-500">Avg. first reply</p><p className="text-sm font-semibold">{c.avgResponse}</p></div>
                </div>
              </div>
            </Card>
          )
        })}
        {channels && (
          <button
            onClick={() => setAdding(true)}
            className="group flex min-h-56 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 transition hover:border-brand-500/50 hover:bg-brand-50/40 hover:text-brand-700"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-slate-100 transition group-hover:bg-surface"><Plus className="size-5" /></span>
            <span className="text-sm font-medium">Add channel</span>
          </button>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a channel" subtitle="Connect another place your customers talk to you.">
        {available.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500"><Radio className="mx-auto mb-2 size-6 text-slate-300" />Every available channel is already connected.</p>
        ) : (
          <ul className="space-y-2">
            {available.map((c) => {
              const l = look(c.id)
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300">
                  <span className={cn('grid size-10 place-items-center rounded-lg', l.tile)}><l.icon className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.desc}</p>
                  </div>
                  {c.id === 'voice' ? (
                    // The phone line is real (Sarvam + the demo API): set it up on its own page.
                    <Button size="sm" variant="primary" icon={Phone} onClick={() => navigate('/phone')}>Set up</Button>
                  ) : (
                  <Button size="sm" variant="primary" disabled={!!connecting} onClick={() => connect(c)}
                    icon={connecting === c.id ? Loader2 : Check}
                    className={connecting === c.id ? '[&>svg]:animate-spin' : ''}>
                    {connecting === c.id ? 'Connecting' : 'Connect'}
                  </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </div>
  )
}
