import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorText, live, type LeadPatch } from './api'
import { OWNER } from '@ph/shared'
import { STATUSES } from './meta'
import type { Approvals, Decision, Lead, Settings, Stats, Status, Step, Ticket, Toast } from './types'

export type NewToast = Omit<Toast, 'id' | 'tone'> & { tone?: Toast['tone'] }

/**
 * The Control Room's shared state. Tickets, leads, approvals, settings and stats are polled from the
 * demo API (Postgres) every few seconds. Writes are real requests; while one is in flight its change is
 * shown optimistically, and it is dropped once the next fetch has the server's version.
 */
export interface AppState {
  tickets: Ticket[]
  leads: Lead[]
  approvals: Approvals
  settings: Settings | null
  stats: Stats | null
  /** True until the first tickets, leads and approvals have arrived. */
  loading: boolean
  /** Set when the demo API can't be reached or a Control Room endpoint fails. */
  error: string | null
  toasts: Toast[]
  toast: (t: NewToast) => void
  dismissToast: (id: string) => void
  /** PATCH a ticket's status (synced to Zendesk by the API). Resolves false if it failed. */
  setTicketStatus: (id: string, status: Status) => Promise<boolean>
  /** Like setTicketStatus, with a toast whose Undo sends the previous status back. */
  moveTicket: (id: string, status: Status) => void
  /** PATCH a lead (its CRM deal). Resolves false if it failed. */
  updateLead: (id: string, patch: LeadPatch) => Promise<boolean>
  decideApproval: (id: string, decision: Decision, note?: string) => void
  saveSettings: (s: Settings) => Promise<boolean>
}

const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}

type Pending<T> = Record<string, { token: number; patch: Partial<T> }[]>
let tokens = 0

/** Optimistic patches by record id, applied over the polled rows until the write and a re-fetch are done. */
function useOptimistic<T>(refresh: () => Promise<void>) {
  const [pending, setPending] = useState<Pending<T>>({})
  const apply = useCallback(
    (rows: T[], id: (r: T) => string) =>
      rows.map((r) => {
        const ps = pending[id(r)]
        return ps?.length ? ps.reduce((acc, p) => ({ ...acc, ...p.patch }), r) : r
      }),
    [pending],
  )
  const run = useCallback(
    async (id: string, patch: Partial<T>, request: () => Promise<unknown>) => {
      const token = ++tokens
      setPending((p) => ({ ...p, [id]: [...(p[id] ?? []), { token, patch }] }))
      try {
        await request()
        await refresh()
      } finally {
        setPending((p) => {
          const left = (p[id] ?? []).filter((x) => x.token !== token)
          const { [id]: _, ...rest } = p
          return left.length ? { ...rest, [id]: left } : rest
        })
      }
    },
    [refresh],
  )
  return { apply, run }
}

const EMPTY_APPROVALS: Approvals = { pending: [], history: [] }

export function AppProvider({ children }: { children: ReactNode }) {
  const ticketsPoll = live.useTickets()
  const leadsPoll = live.useLeads()
  const approvalsPoll = live.useApprovals()
  const settingsPoll = live.useSettings()
  const statsPoll = live.useStats()
  const [toasts, setToasts] = useState<Toast[]>([])

  const refreshTickets = ticketsPoll.refresh
  const refreshLeads = leadsPoll.refresh
  const refreshApprovals = approvalsPoll.refresh
  const refreshSettings = settingsPoll.refresh
  const { apply: applyTicket, run: writeTicket } = useOptimistic<Ticket>(refreshTickets)
  const { apply: applyLead, run: writeLead } = useOptimistic<Lead>(refreshLeads)
  // Approvals decided here but not yet gone from the server's pending list.
  const [deciding, setDeciding] = useState<Set<string>>(() => new Set())

  const tickets = useMemo(() => applyTicket(ticketsPoll.data?.tickets ?? [], (t) => t.id), [ticketsPoll.data, applyTicket])
  const leads = useMemo(() => applyLead(leadsPoll.data?.leads ?? [], (l) => l.id), [leadsPoll.data, applyLead])
  const approvals = useMemo<Approvals>(() => {
    const a = approvalsPoll.data ?? EMPTY_APPROVALS
    return deciding.size ? { ...a, pending: a.pending.filter((p) => !deciding.has(p.id)) } : a
  }, [approvalsPoll.data, deciding])

  const error = ticketsPoll.error ?? leadsPoll.error ?? approvalsPoll.error ?? settingsPoll.error ?? statsPoll.error
  const loading = !error && (!ticketsPoll.data || !leadsPoll.data || !approvalsPoll.data)

  // Undo callbacks read the latest tickets through this ref.
  const ticketsRef = useRef(tickets)
  useEffect(() => { ticketsRef.current = tickets })

  const dismissToast = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const toast = useCallback(
    (t: NewToast) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((ts) => [...ts.slice(-3), { id, tone: 'success', ...t }])
      setTimeout(() => dismissToast(id), t.action ? 6000 : 3500)
    },
    [dismissToast],
  )
  const failed = useCallback((title: string, e: unknown) => toast({ tone: 'neutral', title, desc: errorText(e) }), [toast])

  const setTicketStatus = useCallback(
    async (id: string, status: Status) => {
      const t = ticketsRef.current.find((x) => x.id === id)
      const patch: Partial<Ticket> = { status, ...(status === 'solved' && t && !t.solvedBy ? { solvedBy: 'human' as const } : {}) }
      try {
        await writeTicket(id, patch, () => api.updateTicketStatus(id, status))
        return true
      } catch (e) {
        failed(`Couldn't update ${id}`, e)
        return false
      }
    },
    [writeTicket, failed],
  )

  const moveTicket = useCallback(
    (id: string, status: Status) => {
      const ticket = ticketsRef.current.find((t) => t.id === id)
      if (!ticket || ticket.status === status) return
      const before = ticket.status
      setTicketStatus(id, status).then((ok) => {
        if (!ok) return
        toast({
          title: `${id} moved to ${STATUSES[status].label}`,
          desc: `Synced to Zendesk (${ticket.helpdeskId})`,
          action: { label: 'Undo', onClick: () => void setTicketStatus(id, before) },
        })
      })
    },
    [setTicketStatus, toast],
  )

  const updateLead = useCallback(
    async (id: string, patch: LeadPatch) => {
      try {
        await writeLead(id, patch, () => api.updateLead(id, patch))
        return true
      } catch (e) {
        failed(`Couldn't update lead ${id}`, e)
        return false
      }
    },
    [writeLead, failed],
  )

  const decideApproval = useCallback(
    (id: string, decision: Decision, note?: string) => {
      setDeciding((s) => new Set(s).add(id))
      const done = () => setDeciding((s) => { const n = new Set(s); n.delete(id); return n })
      api.decideApproval(id, decision, note)
        .then(async (res) => {
          await Promise.all([refreshApprovals(), refreshTickets(), refreshLeads()])
          toast({
            tone: decision === 'approved' && !res.warning ? 'success' : 'neutral',
            title: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${id} as ${OWNER.first}`,
            desc: res.warning ?? (decision === 'approved' ? 'Aria is carrying out the action now.' : 'Handed to a human agent.'),
          })
        })
        .catch((e) => failed(`Couldn't record the decision on ${id}`, e))
        .finally(done)
    },
    [refreshApprovals, refreshTickets, refreshLeads, toast, failed],
  )

  const saveSettings = useCallback(
    async (s: Settings) => {
      try {
        await api.saveSettings(s)
        await refreshSettings()
        return true
      } catch (e) {
        failed('Couldn’t save the settings', e)
        return false
      }
    },
    [refreshSettings, failed],
  )

  const settings = settingsPoll.data ?? null
  const stats = statsPoll.data ?? null
  const value = useMemo<AppState>(
    () => ({
      tickets, leads, approvals, settings, stats, loading, error,
      toasts, toast, dismissToast, setTicketStatus, moveTicket, updateLead, decideApproval, saveSettings,
    }),
    [tickets, leads, approvals, settings, stats, loading, error, toasts, toast, dismissToast, setTicketStatus, moveTicket, updateLead, decideApproval, saveSettings],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export type AuditRow = Step & { key: string; ref: string; kind: 'ticket' | 'lead'; who: string }

// Every agent action across tickets and leads, newest first.
export function useAuditLog(): AuditRow[] {
  const { tickets, leads } = useApp()
  return useMemo(() => {
    const rows: AuditRow[] = []
    tickets.forEach((t) =>
      t.steps.forEach((s, i) => rows.push({ ...s, key: `${t.id}-${i}`, ref: t.id, kind: 'ticket', who: t.customer.name })),
    )
    leads.forEach((l) =>
      l.steps.forEach((s, i) => rows.push({ ...s, key: `${l.id}-${i}`, ref: l.id, kind: 'lead', who: l.name || l.company })),
    )
    return rows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  }, [tickets, leads])
}
