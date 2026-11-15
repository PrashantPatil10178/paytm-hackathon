import { useState } from 'react'
import { Unplug, RefreshCw, Loader2, Star, Zap, CheckCircle2, ShieldCheck, Cable } from 'lucide-react'
import { api, errorText, live } from '../api'
import { useApp } from '../store'
import { ConnectorAccess } from '../components/AgentAccess'
import { OWNER } from '@ph/shared'
import { Card, PageHeader, Badge, Button, Modal, Skeleton, EmptyState } from '../components/ui'
import { ago, cn, num, rupees } from '../lib'
import type { Connector } from '../types'

/** The tool's own brand colour, as its logo tile. */
const Logo = ({ c, size = 'size-11' }: { c: Connector; size?: string }) => (
  <span className={cn('grid shrink-0 place-items-center rounded-xl text-sm font-bold text-white shadow-sm', size)} style={{ background: c.color }} aria-hidden>
    {c.name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('')}
  </span>
)

function StatusPill({ status }: { status: string }) {
  if (status === 'connected') return <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-200" dot="bg-emerald-500">Connected</Badge>
  if (status === 'disabled') return <Badge className="bg-slate-100 text-slate-600 ring-slate-200" dot="bg-slate-400">Disconnected</Badge>
  return <Badge className="bg-red-50 text-red-700 ring-red-200" dot="bg-red-500">Not reachable</Badge>
}

/** The tools Aria works inside, live from the platform's connectors (rai_connectors). */
export default function Connectors() {
  const { toast, settings } = useApp()
  const { data, error, refresh } = live.useConnectors()
  const [busy, setBusy] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<Connector | null>(null)
  // Bumped after a change here, so the access panel below re-fetches at once.
  const [version, setVersion] = useState(0)

  const connectors = data?.connectors ?? []
  const done = async () => { await refresh(); setVersion((v) => v + 1) }

  const disconnect = async (c: Connector) => {
    setDisconnecting(null)
    setBusy(c.id)
    try {
      await api.setConnectorEnabled(c.id, false)
      await done()
      toast({ tone: 'neutral', title: `${c.name} disconnected`, desc: 'Aria can no longer read from or act in this tool; its calls fail with a clear error.' })
    } catch (e) {
      toast({ tone: 'neutral', title: `Couldn’t disconnect ${c.name}`, desc: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const reconnect = async (c: Connector) => {
    setBusy(c.id)
    try {
      await api.setConnectorEnabled(c.id, true)
      await api.checkConnector(c.id)
      await done()
      toast({ title: `${c.name} reconnected`, desc: 'Checked against the live API.' })
    } catch (e) {
      toast({ tone: 'neutral', title: `Couldn’t reconnect ${c.name}`, desc: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const check = async (c: Connector) => {
    setBusy(c.id)
    try {
      await api.checkConnector(c.id)
      await done()
    } catch (e) {
      toast({ tone: 'neutral', title: `${c.name} check failed`, desc: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const connected = connectors.filter((c) => c.status === 'connected').length
  const actions = connectors.reduce((a, c) => a + (c.actionsToday || 0), 0)

  return (
    <div>
      <PageHeader
        title="Connectors"
        description="The tools Aria works inside. Each one is a base URL and a token; disconnect one and Aria stops using it at once."
      />

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MiniStat icon={Zap} label="Connected tools" value={data ? `${connected} of ${connectors.length}` : '–'} />
        <MiniStat icon={CheckCircle2} label="Actions taken today" value={data ? num(actions) : '–'} />
        <MiniStat icon={ShieldCheck} label="Refunds above this need approval" value={settings ? rupees(settings.refundLimit) : '–'} />
      </div>

      {!data && error && <Card className="mb-6"><EmptyState icon={Cable} title="Connectors aren't available" text={`The demo API didn't return them: ${error}`} /></Card>}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {!data && !error && Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-60 p-5"><Skeleton className="size-11" /><Skeleton className="mt-4 h-4 w-32" /></Card>)}
        {connectors.map((c) => {
          const off = c.status === 'disabled'
          const working = busy === c.id
          return (
            <Card key={c.id} className={cn('flex flex-col p-5', off && 'bg-slate-50/70')}>
              <div className="flex items-start gap-3">
                <div className={cn(off && 'opacity-40 grayscale')}><Logo c={c} /></div>
                <div className="min-w-0 flex-1">
                  <h3 className="leading-snug font-semibold text-slate-900">{c.name}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 text-xs text-slate-500">{c.category}</span>
                    <StatusPill status={c.status} />
                    {c.primary && <Badge className="bg-slate-100 text-slate-700 ring-slate-200"><Star className="size-3" aria-hidden />Primary</Badge>}
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs text-slate-500">Aria can</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.capabilities.map((cap) => (
                  <span key={cap} className={cn('rounded-md px-2 py-1 text-xs', off ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-700')}>{cap}</span>
                ))}
              </div>

              <p className="mt-auto pt-4 text-xs text-slate-500">
                {off ? 'Disconnected' : <>{c.lastSync ? <>Checked <span className="ref">{ago(c.lastSync)}</span></> : 'Not checked yet'} · <span className="ref">{num(c.actionsToday || 0)}</span> actions today</>}
              </p>
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                {off ? (
                  <Button size="sm" variant="primary" icon={working ? Loader2 : RefreshCw} className={working ? '[&>svg]:animate-spin' : ''} disabled={working} onClick={() => reconnect(c)}>Reconnect</Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" icon={Unplug} disabled={working} onClick={() => setDisconnecting(c)}>Disconnect</Button>
                    <Button size="sm" icon={working ? Loader2 : RefreshCw} className={working ? '[&>svg]:animate-spin' : ''} disabled={working} onClick={() => check(c)}>Check</Button>
                  </>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      {data && (data.catalog?.length ?? 0) === 0 && (
        <p className="-mt-3 mb-6 text-xs text-slate-500">These are all the tools ResolveAI can connect to in this workspace. No others are available yet.</p>
      )}

      {/* Base URL and token per tool. The cards above hold connect/disconnect, so the panel doesn't repeat it. */}
      <ConnectorAccess refreshKey={version} onChange={() => void refresh()} toggles={false} />

      <Modal
        open={!!disconnecting}
        onClose={() => setDisconnecting(null)}
        title={`Disconnect ${disconnecting?.name}?`}
        subtitle="Aria will stop reading from and acting in this tool. You can reconnect any time."
        footer={<><Button onClick={() => setDisconnecting(null)}>Cancel</Button><Button variant="destructive" onClick={() => disconnecting && disconnect(disconnecting)}>Disconnect</Button></>}
      >
        {disconnecting?.primary && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">This is the primary {disconnecting.category.toLowerCase()}. While it is off, Aria can't open or update tickets and hands requests to {OWNER.first}.</p>
        )}
      </Modal>
    </div>
  )
}

const MiniStat = ({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-surface px-4 py-3.5">
    <span className="grid size-9 place-items-center rounded-lg border border-ink/[0.08] bg-ink/[0.03] text-slate-600"><Icon className="size-4" /></span>
    <div><p className="text-xs text-slate-500">{label}</p><p className="ref text-base font-semibold text-slate-900">{value}</p></div>
  </div>
)
