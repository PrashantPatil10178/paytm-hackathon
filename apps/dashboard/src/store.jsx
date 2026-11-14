import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import { STATUSES, CHANNELS } from './meta'
import { rupees } from './lib'

const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)

export function AppProvider({ children }) {
  const [tickets, setTickets] = useState([])
  const [leads, setLeads] = useState([])
  const [approvals, setApprovals] = useState({ pending: [], history: [] })
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState([])

  // Mirrors of state so undo callbacks always snapshot the latest values.
  const ticketsRef = useRef(tickets)
  const approvalsRef = useRef(approvals)
  ticketsRef.current = tickets
  approvalsRef.current = approvals

  useEffect(() => {
    Promise.all([api.getTickets(), api.getLeads(), api.getApprovals(), api.getSettings()]).then(
      ([t, l, a, s]) => {
        setTickets(t)
        setLeads(l)
        setApprovals(a)
        setSettings(s)
        setLoading(false)
      },
    )
  }, [])

  const dismissToast = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), [])
  const toast = useCallback(
    (t) => {
      const id = Math.random().toString(36).slice(2)
      setToasts((ts) => [...ts.slice(-3), { id, tone: 'success', ...t }])
      setTimeout(() => dismissToast(id), t.action ? 6000 : 3500)
    },
    [dismissToast],
  )

  const moveTicket = useCallback(
    (id, status) => {
      const prev = ticketsRef.current
      const ticket = prev.find((t) => t.id === id)
      if (!ticket || ticket.status === status) return
      setTickets((ts) =>
        ts.map((t) =>
          t.id === id
            ? { ...t, status, solvedBy: status === 'solved' ? t.solvedBy || 'human' : t.solvedBy }
            : t,
        ),
      )
      api.updateTicketStatus(id, status)
      const desk = ticket.helpdesk === 'zendesk' ? 'Zendesk' : 'Freshdesk'
      toast({
        title: `${id} moved to ${STATUSES[status].label}`,
        desc: `Synced to ${desk} (${ticket.helpdeskId})`,
        action: { label: 'Undo', onClick: () => setTickets(prev) },
      })
    },
    [toast],
  )

  const decideApproval = useCallback(
    (id, decision, note) => {
      const prevTickets = ticketsRef.current
      const prevApprovals = approvalsRef.current
      const item = prevApprovals.pending.find((a) => a.id === id)
      if (!item) return
      const now = new Date().toISOString()

      setApprovals((a) => ({
        pending: a.pending.filter((p) => p.id !== id),
        history: [{ ...item, decision, by: 'You', note, decidedAt: now }, ...a.history],
      }))

      if (item.kind === 'ticket') {
        setTickets((ts) =>
          ts.map((t) => {
            if (t.id !== item.ref) return t
            const approved = decision === 'approved'
            const step = {
              step: approved ? 'Human approved' : 'Human rejected',
              tool: 'Approvals',
              result: approved ? 'success' : 'blocked',
              time: now,
              detail: approved
                ? `Approved by you: "${item.suggestion}"`
                : `Rejected by you${note ? `: "${note}"` : ''}. Handed to a human agent.`,
            }
            const followUps = approved
              ? [{ step: 'Execute action', tool: item.amount ? 'Paytm' : 'Aria LLM', result: 'success', time: now, detail: item.amount ? `Refund of ${rupees(item.amount)} issued` : 'Action completed' },
                 { step: 'Reply', tool: CHANNELS[t.channel].label, result: 'success', time: now, detail: 'Customer notified of the resolution' }]
              : []
            return {
              ...t,
              status: approved ? 'solved' : 'in_progress',
              solvedBy: approved ? 'ai' : t.solvedBy,
              steps: [...t.steps, step, ...followUps],
              result: approved ? `Approved by a human, then completed by the AI. ${item.suggestion}` : 'Rejected by a human. A human agent is now handling it.',
            }
          }),
        )
      }
      api.decideApproval(id, decision, note)
      toast({
        tone: decision === 'approved' ? 'success' : 'neutral',
        title: decision === 'approved' ? `Approved ${id}` : `Rejected ${id}`,
        desc: decision === 'approved' ? 'Aria is carrying out the action now.' : 'Handed to a human agent.',
        action: {
          label: 'Undo',
          onClick: () => {
            setTickets(prevTickets)
            setApprovals(prevApprovals)
          },
        },
      })
    },
    [toast],
  )

  const value = useMemo(
    () => ({
      tickets, leads, approvals, settings, setSettings, loading,
      toasts, toast, dismissToast, moveTicket, decideApproval,
    }),
    [tickets, leads, approvals, settings, loading, toasts, toast, dismissToast, moveTicket, decideApproval],
  )
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// Every agent action across tickets and leads, newest first.
export function useAuditLog() {
  const { tickets, leads } = useApp()
  return useMemo(() => {
    const rows = []
    tickets.forEach((t) =>
      t.steps.forEach((s, i) => rows.push({ ...s, key: `${t.id}-${i}`, ref: t.id, kind: 'ticket', who: t.customer.name })),
    )
    leads.forEach((l) =>
      l.steps.forEach((s, i) => rows.push({ ...s, key: `${l.id}-${i}`, ref: l.id, kind: 'lead', who: l.name })),
    )
    return rows.sort((a, b) => new Date(b.time) - new Date(a.time))
  }, [tickets, leads])
}
