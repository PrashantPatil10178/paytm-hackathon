import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, Settings2, Unplug, RefreshCw, Loader2, Star, Zap, CheckCircle2, ShieldCheck, Lock } from 'lucide-react'
import { api } from '../api'
import { useApp } from '../store'
import { ConnectorAccess } from '../components/AgentAccess'
import { Card, PageHeader, Badge, Button, Modal, Drawer, Toggle, Select, Skeleton } from '../components/ui'
import { ago, cn, rupees } from '../lib'

const Logo = ({ c, size = 'size-11' }) => (
  <span className={cn('grid shrink-0 place-items-center rounded-xl text-sm font-bold text-white shadow-sm', size)} style={{ background: c.color }}>
    {c.name.replace(/[^A-Za-z ]/g, '').split(' ').slice(0, 2).map((w) => w[0]).join('')}
  </span>
)

const WRITE = /refund|create|update|send|schedule|log|cancel|book|append|post|reply/i

export default function Connectors() {
  const { toast, settings } = useApp()
  const [connectors, setConnectors] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [adding, setAdding] = useState(false)
  const [configuring, setConfiguring] = useState(null)
  const [disconnecting, setDisconnecting] = useState(null)

  useEffect(() => { api.getConnectors().then((d) => { setConnectors(d.connectors); setCatalog(d.catalog) }) }, [])

  const update = (id, patch) => setConnectors((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  const makePrimary = (c) => {
    setConnectors((cs) => cs.map((x) => (x.category === 'Helpdesk' ? { ...x, primary: x.id === c.id } : x)))
    toast({ title: `Helpdesk switched to ${c.name}`, desc: 'New tickets are created there from now on. No code changes needed.' })
  }

  const disconnect = (c) => {
    update(c.id, { status: 'disconnected', primary: false })
    setDisconnecting(null)
    toast({ tone: 'neutral', title: `${c.name} disconnected`, desc: 'The agent can no longer use this tool.' })
  }

  const reconnect = async (c) => {
    update(c.id, { status: 'syncing' })
    await api.connect(c.id)
    update(c.id, { status: 'connected', lastSync: new Date().toISOString() })
    toast({ title: `${c.name} reconnected` })
  }

  const add = async (item) => {
    setConnectors((cs) => [...cs, { ...item, status: 'syncing', lastSync: new Date().toISOString(), actionsToday: 0 }])
    setAdding(false)
    await api.connect(item.id)
    update(item.id, { status: 'connected', lastSync: new Date().toISOString() })
    toast({ title: `${item.name} connected`, desc: `The agent can now: ${item.capabilities.join(', ').toLowerCase()}.` })
  }

  const live = connectors?.filter((c) => c.status === 'connected').length ?? 0
  const actions = connectors?.reduce((a, c) => a + (c.actionsToday || 0), 0) ?? 0

  return (
    <div>
      <PageHeader
        title="Connectors"
        description="The tools the agent can work inside. Plug in a new one and it just works, with no code."
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add connector</Button>}
      />

      <ConnectorAccess />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MiniStat icon={Zap} label="Connected tools" value={connectors ? `${live} of ${connectors.length}` : '–'} />
        <MiniStat icon={CheckCircle2} label="Actions taken today" value={actions} />
        <MiniStat icon={ShieldCheck} label="Write actions need approval above" value={rupees(settings?.refundLimit)} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {!connectors && Array.from({ length: 6 }).map((_, i) => <Card key={i} className="h-60 p-5"><Skeleton className="size-11" /><Skeleton className="mt-4 h-4 w-32" /></Card>)}
        {connectors?.map((c) => {
          const off = c.status === 'disconnected'
          return (
            <Card key={c.id} className={cn('flex flex-col p-5', off && 'bg-slate-50/70')}>
              <div className="flex items-start gap-3">
                <div className={cn(off && 'opacity-40 grayscale')}><Logo c={c} /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="leading-snug font-semibold text-slate-900">{c.name}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-xs text-slate-500">{c.category}</span>
                    <StatusPill status={c.status} />
                    {c.primary && <Badge className="bg-amber-50 text-amber-800 ring-amber-200"><Star className="size-3 fill-current" aria-hidden />Primary</Badge>}
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs text-slate-500">The agent can</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.capabilities.map((cap) => (
                  <span key={cap} className={cn('rounded-md px-2 py-1 text-xs', off ? 'bg-slate-100 text-slate-400' : WRITE.test(cap) ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-700')}>
                    {cap}
                  </span>
                ))}
              </div>

              <p className="mt-auto pt-4 text-xs text-slate-400">
                {off ? 'Not connected' : c.status === 'syncing' ? 'Syncing…' : `Synced ${ago(c.lastSync)} · ${c.actionsToday} actions today`}
              </p>
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                {off ? (
                  <Button size="sm" variant="primary" icon={RefreshCw} onClick={() => reconnect(c)}>Reconnect</Button>
                ) : (
                  <>
                    {c.category === 'Helpdesk' && !c.primary && c.status === 'connected' && (
                      <Button size="sm" variant="ghost" onClick={() => makePrimary(c)}>Make primary</Button>
                    )}
                    <Button size="sm" variant="ghost" icon={Unplug} aria-label={`Disconnect ${c.name}`} title="Disconnect" onClick={() => setDisconnecting(c)} />
                    <Button size="sm" icon={Settings2} onClick={() => setConfiguring(c)} disabled={c.status === 'syncing'}>Configure</Button>
                  </>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      <CatalogModal open={adding} onClose={() => setAdding(false)} catalog={catalog} installed={connectors || []} onAdd={add} />
      <ConfigureDrawer c={configuring} onClose={() => setConfiguring(null)} refundLimit={settings?.refundLimit} onSave={(c) => { toast({ title: `${c.name} settings saved` }); setConfiguring(null) }} />

      <Modal
        open={!!disconnecting}
        onClose={() => setDisconnecting(null)}
        title={`Disconnect ${disconnecting?.name}?`}
        subtitle="The agent will stop reading from and acting in this tool. You can reconnect anytime."
        footer={<><Button onClick={() => setDisconnecting(null)}>Cancel</Button><Button variant="destructive" onClick={() => disconnect(disconnecting)}>Disconnect</Button></>}
      >
        {disconnecting?.primary && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">This is your primary helpdesk. Make another helpdesk primary first so new tickets still have a home.</p>
        )}
      </Modal>
    </div>
  )
}

function StatusPill({ status }) {
  if (status === 'connected') return <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200" dot="bg-emerald-500">Connected</Badge>
  if (status === 'syncing') return <Badge className="bg-sky-50 text-sky-700 ring-sky-200"><Loader2 className="size-3 animate-spin" />Connecting</Badge>
  return <Badge className="bg-slate-100 text-slate-600 ring-slate-200" dot="bg-slate-400">Disconnected</Badge>
}

const MiniStat = ({ icon: Icon, label, value }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-surface px-4 py-3.5">
    <span className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-600"><Icon className="size-4" /></span>
    <div><p className="text-xs text-slate-500">{label}</p><p className="text-base font-semibold text-slate-900 tabular">{value}</p></div>
  </div>
)

function CatalogModal({ open, onClose, catalog, installed, onAdd }) {
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('All')
  const cats = ['All', ...new Set(catalog.map((c) => c.category))]
  const items = useMemo(
    () => catalog.filter((c) => (cat === 'All' || c.category === cat) && c.name.toLowerCase().includes(q.toLowerCase())),
    [catalog, q, cat],
  )
  return (
    <Modal open={open} onClose={onClose} width="max-w-3xl" title="Add a connector" subtitle="Give the agent access to another tool. It learns the actions automatically.">
      <div className="sticky top-0 z-10 -mx-6 bg-surface px-6 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Freshdesk, Shopify, Razorpay…" className="h-10 w-full rounded-lg border border-slate-200 pr-3 pl-9 text-sm outline-none focus:border-brand-500" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn('rounded-full px-3 py-1 text-xs font-medium transition', cat === c ? 'bg-slate-900 text-canvas' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{c}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((c) => {
          const done = installed.some((x) => x.id === c.id)
          return (
            <div key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300 hover:shadow-sm">
              <Logo c={c} size="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{c.name}</p>
                <p className="truncate text-xs text-slate-500">{c.category} · {c.capabilities.join(', ')}</p>
              </div>
              {done ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="size-3.5" />Added</span>
                : <Button size="sm" variant="primary" onClick={() => onAdd(c)}>Connect</Button>}
            </div>
          )
        })}
        {items.length === 0 && <p className="col-span-full py-10 text-center text-sm text-slate-500">Nothing matches "{q}". Ask us to build it, since new connectors take about a day.</p>}
      </div>
    </Modal>
  )
}

function ConfigureDrawer({ c, onClose, onSave, refundLimit }) {
  const [perms, setPerms] = useState({})
  const [freq, setFreq] = useState('realtime')
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(null)

  useEffect(() => {
    if (c) {
      setPerms(Object.fromEntries(c.capabilities.map((cap) => [cap, true])))
      setTested(null)
    }
  }, [c])

  const test = () => {
    setTesting(true)
    setTimeout(() => { setTesting(false); setTested(Math.round(120 + Math.random() * 120)) }, 900)
  }

  return (
    <Drawer
      open={!!c}
      onClose={onClose}
      title={c && <div className="flex items-center gap-3"><Logo c={c} size="size-10" /><div><h2 className="text-base font-semibold">{c.name}</h2><p className="text-xs text-slate-500">{c.category} connector</p></div></div>}
    >
      {c && (
        <div className="space-y-6 p-6">
          <section>
            <h3 className="text-sm font-semibold text-slate-900">Authentication</h3>
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <Lock className="size-4 text-slate-400" />
              <span className="flex-1 text-sm text-slate-600">OAuth · connected as <b className="font-medium text-slate-900">ops@shopkart.in</b></span>
              <Button size="sm" variant="ghost">Re-authorise</Button>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-900">What the agent may do</h3>
            <p className="text-xs text-slate-500">Turn off anything you don't want automated.</p>
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {c.capabilities.map((cap) => (
                <li key={cap} className="flex items-center gap-3 px-3 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{cap}</p>
                    <p className="text-xs text-slate-500">
                      {WRITE.test(cap) ? (/refund/i.test(cap) ? `Write · needs approval above ${rupees(refundLimit)}` : 'Write action · logged in audit') : 'Read only'}
                    </p>
                  </div>
                  <Toggle checked={!!perms[cap]} onChange={(v) => setPerms((p) => ({ ...p, [cap]: v }))} label={cap} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-900">Sync frequency</h3>
            <Select label="Sync frequency" value={freq} onChange={setFreq} className="w-full" options={[
              { value: 'realtime', label: 'Real time (webhooks)' }, { value: '5m', label: 'Every 5 minutes' }, { value: '1h', label: 'Hourly' },
            ]} />
          </section>

          <section className="rounded-lg bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">Connection health</p>
                <p className="text-xs text-slate-500">{tested ? `Healthy · responded in ${tested} ms` : 'Run a quick check against the live API'}</p>
              </div>
              <Button size="sm" icon={testing ? Loader2 : tested ? CheckCircle2 : RefreshCw} className={testing ? '[&>svg]:animate-spin' : tested ? 'text-emerald-700' : ''} onClick={test} disabled={testing}>
                {testing ? 'Testing' : tested ? 'Passed' : 'Test connection'}
              </Button>
            </div>
          </section>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => onSave(c)}>Save changes</Button>
          </div>
        </div>
      )}
    </Drawer>
  )
}
