/**
 * Live ResolveAI config, read from the demo API (/resolveai/*, proxied as /api/resolveai):
 * - ChannelAccess: where each channel sends requests (the agent's intake URL) and its token.
 * - ConnectorAccess: the base URL and token the agents use for each tool, with a live health dot.
 * The Channels and Connectors pages show the same records with their activity (/control-room/*); these
 * panels hold the access details. Pass `refreshKey` to make a panel re-fetch after the page changed a
 * record, and `onChange` to hear about changes made here.
 */
import { useCallback, useEffect, useState } from 'react'
import { Cable, Check, Copy, KeyRound, Loader2, RefreshCw, Radio } from 'lucide-react'
import type { Channel, ChannelToken, Connector } from '@ph/shared'
import { Badge, Button, Panel, Toggle } from './ui'
import { ago, cn } from '../lib'
import { useApp } from '../store'

const BASE = '/api/resolveai'
/** Where channels send requests. The agent service (apps/agent) on :8000 unless VITE_AGENT_URL says otherwise. */
export const INTAKE_URL = `${(import.meta.env.VITE_AGENT_URL as string | undefined) ?? 'http://localhost:8000'}/intake`

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
  return data as T
}

function useLive<T>(path: string, pick: (d: any) => T, every = 5000, refreshKey?: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    call<unknown>('GET', path).then((d) => { setData(pick(d)); setError(null) }).catch((e: Error) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  useEffect(() => {
    load()
    const t = setInterval(load, every)
    return () => clearInterval(t)
  }, [load, every, refreshKey])
  return { data, error, reload: load, setData }
}

/** Green when it works, amber when it needs setup, grey when off, red when it fails. */
function Dot({ tone, label }: { tone: 'ok' | 'warn' | 'off' | 'bad'; label: string }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-800 ring-amber-200',
    off: 'bg-slate-100 text-slate-600 ring-slate-200',
    bad: 'bg-red-50 text-red-700 ring-red-200',
  }[tone]
  const dot = { ok: 'bg-emerald-500', warn: 'bg-amber-500', off: 'bg-slate-400', bad: 'bg-red-500' }[tone]
  return <Badge className={cls} dot={dot}>{label}</Badge>
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button size="sm" variant="ghost" icon={done ? Check : Copy} onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? 'Copied' : label}
    </Button>
  )
}

const unreachable = (error: string | null) =>
  error && <p className="px-4 py-3 text-xs text-red-700">Can't reach the demo API ({error}). Is <span className="ref">bun run dev</span> running?</p>

/* ───── Channels ───── */

export function ChannelAccess({ refreshKey, onChange, toggles = true }: { refreshKey?: number; onChange?: () => void; toggles?: boolean } = {}) {
  const { toast } = useApp()
  const { data: channels, error, reload } = useLive<Channel[]>('/channels', (d) => d.channels, 5000, refreshKey)
  const [fresh, setFresh] = useState<ChannelToken | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const rotate = async (c: Channel) => {
    setBusy(c.id)
    try {
      setFresh(await call<ChannelToken>('POST', `/channels/${c.id}/token`))
      reload()
      onChange?.()
    } catch (e) {
      toast({ tone: 'neutral', title: 'Couldn’t create a token', desc: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const toggle = async (c: Channel, enabled: boolean) => {
    await call('PATCH', `/channels/${c.id}`, { enabled }).catch(() => {})
    reload()
    onChange?.()
  }

  return (
    <Panel icon={Radio} title="Agent intake" meta={INTAKE_URL} className="mb-6" action={<CopyButton text={INTAKE_URL} label="Copy URL" />}>
      {unreachable(error)}
      <ul className="divide-y divide-ink/[0.06]">
        {channels?.map((c) => {
          // Voice calls and the enquiry form reach Aria through the demo API, not the intake, so they need no token.
          const tokenless = (c.kind as string) === 'voice' || (c.kind as string) === 'form'
          const tone = !c.enabled ? 'off' : c.token_hint || tokenless ? 'ok' : 'warn'
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-40 flex-1">
                <p className="text-[13px] font-medium text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">{c.last_used_at ? `Last request ${ago(c.last_used_at)}` : 'No requests yet'}</p>
              </div>
              <Dot tone={tone} label={tone === 'ok' ? 'Connected' : tone === 'warn' ? 'Needs a token' : 'Off'} />
              <span className="ref text-xs text-slate-500">{c.token_hint ? `rai_…${c.token_hint}` : tokenless ? 'no token needed' : 'no token'}</span>
              <Button size="sm" icon={busy === c.id ? Loader2 : KeyRound} className={busy === c.id ? '[&>svg]:animate-spin' : ''} onClick={() => rotate(c)} disabled={busy === c.id}>
                {c.token_hint ? 'New token' : 'Create token'}
              </Button>
              {toggles && <Toggle checked={c.enabled} onChange={(v) => toggle(c, v)} label={`Turn ${c.name} on or off`} />}
            </li>
          )
        })}
      </ul>
      {fresh && (
        <div className="border-t border-ink/[0.06] bg-amber-50/60 px-4 py-3">
          <p className="text-xs font-medium text-amber-900">New token for {fresh.channel.name}. Copy it now: it won’t be shown again, and the old token has stopped working.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="ref min-w-0 flex-1 truncate rounded-md border border-ink/10 bg-surface px-2 py-1 text-xs text-slate-800">{fresh.token}</code>
            <CopyButton text={fresh.token} />
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Done</Button>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            The channel sends it as <span className="ref">Authorization: Bearer &lt;token&gt;</span> to the intake URL.
            {fresh.channel.id === 'shopkart' && ' The demo API already uses the new ShopKart token; put it in SHOPKART_CHANNEL_TOKEN to keep it after a restart.'}
          </p>
        </div>
      )}
    </Panel>
  )
}

/* ───── Connectors ───── */

function ConnectorRow({ c, onSaved, toggles }: { c: Connector; onSaved: (c: Connector) => void; toggles: boolean }) {
  const { toast } = useApp()
  const [url, setUrl] = useState(c.base_url)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  useEffect(() => setUrl(c.base_url), [c.base_url])

  const dirty = url.trim() !== c.base_url || token.trim() !== ''
  const tone = c.status === 'connected' ? 'ok' : c.status === 'disabled' ? 'off' : 'bad'

  const save = async (patch: Record<string, unknown>) => {
    setBusy('save')
    try {
      const next = await call<Connector>('PATCH', `/connectors/${c.id}`, patch)
      onSaved(next)
      setToken('')
      toast({ tone: next.status === 'connected' ? 'success' : 'neutral', title: `${c.name} saved`, desc: next.status === 'connected' ? 'The agents use the new settings now.' : (next.last_error ?? 'Turned off') })
    } catch (e) {
      toast({ tone: 'neutral', title: `Couldn’t save ${c.name}`, desc: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }
  const test = async () => {
    setBusy('test')
    try {
      onSaved(await call<Connector>('POST', `/connectors/${c.id}/check`))
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-36">
          <p className="text-[13px] font-medium text-slate-900">{c.name}</p>
          <p className="text-xs text-slate-500">{c.category}</p>
        </div>
        <Dot tone={tone} label={tone === 'ok' ? 'Connected' : tone === 'off' ? 'Off' : 'Not reachable'} />
        <span className="text-xs text-slate-400">{c.last_checked_at ? `checked ${ago(c.last_checked_at)}` : ''}</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" icon={busy === 'test' ? Loader2 : RefreshCw} className={busy === 'test' ? '[&>svg]:animate-spin' : ''} onClick={test} disabled={!!busy}>Test</Button>
          {toggles && <Toggle checked={c.enabled} onChange={(v) => save({ enabled: v })} label={`Let the agents use ${c.name}`} />}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label={`${c.name} base URL`}
          className="ref h-8 min-w-64 flex-[2] rounded-lg border border-ink/10 bg-surface px-2.5 text-xs text-slate-800 outline-none focus:border-slate-400"
        />
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={c.token_hint ? `token …${c.token_hint} (type to replace)` : 'API token (optional)'}
          aria-label={`${c.name} API token`}
          autoComplete="off"
          className="ref h-8 min-w-48 flex-1 rounded-lg border border-ink/10 bg-surface px-2.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-slate-400"
        />
        <Button size="sm" variant="primary" icon={busy === 'save' ? Loader2 : Check} className={busy === 'save' ? '[&>svg]:animate-spin' : ''} disabled={!dirty || !!busy}
          onClick={() => save({ base_url: url.trim(), ...(token.trim() && { token: token.trim() }) })}>
          Save
        </Button>
        {c.token_hint && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => save({ token: null })}>Clear token</Button>}
      </div>
      {c.last_error && c.status === 'error' && <p className={cn('mt-1.5 text-xs text-red-700')}>{c.last_error}</p>}
    </li>
  )
}

export function ConnectorAccess({ refreshKey, onChange, toggles = true }: { refreshKey?: number; onChange?: () => void; toggles?: boolean } = {}) {
  const { data: connectors, error, setData } = useLive<Connector[]>('/connectors', (d) => d.connectors, 15000, refreshKey)
  const saved = (next: Connector) => {
    setData((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null)
    onChange?.()
  }
  return (
    <Panel icon={Cable} title="Agent access" meta="Where the agents send each tool's API calls" className="mb-6">
      {unreachable(error)}
      <ul className="divide-y divide-ink/[0.06]">
        {connectors?.map((c) => <ConnectorRow key={c.id} c={c} onSaved={saved} toggles={toggles} />)}
      </ul>
    </Panel>
  )
}
