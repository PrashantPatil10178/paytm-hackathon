// Registers what Aria can do from the chat: the generative-UI cards (frontend tools with a render)
// and page navigation, plus the live dashboard data it reads as context. Mounted once, inside the
// CopilotKit provider, the store and the router.
import { useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAgentContext, useConfigureSuggestions, useFrontendTool } from '@copilotkit/react-core/v2'
import { OWNER } from '@ph/shared'
import { useApp } from '../store'
import { CHANNELS } from '../meta'
import { ApprovalsCard, LeadCard, MetricsCard, TicketCard, TicketListCard } from './cards'

const PAGES = {
  overview: '/', analytics: '/analytics', audit: '/audit', tickets: '/tickets', approvals: '/approvals', board: '/board',
  leads: '/leads', calls: '/calls', campaigns: '/campaigns', sales_analytics: '/sales/analytics', channels: '/channels', connectors: '/connectors', settings: '/settings', policies: '/policies',
}

const STATUS = z.enum(['open', 'in_progress', 'waiting', 'solved'])
const LEVEL = z.enum(['low', 'medium', 'high', 'critical'])
const CHANNEL = z.enum(Object.keys(CHANNELS))

// A card's render gets the (partial, while streaming) arguments; the cards take them as props.
const card = (Component) => function Render({ args }) { return <Component {...args} /> }

export default function AriaTools() {
  const app = useApp()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Handlers run later, when the model calls them; read the latest store through a ref so each
  // tool is registered once instead of on every 2 s data change.
  const live = useRef(app)
  useEffect(() => { live.current = app })

  /* ── What Aria can see ── */


  const snapshot = useMemo(() => ({
    tickets: app.tickets.map((t) => ({
      id: t.id, customer: t.customer.name, city: t.customer.city, issue: t.issue,
      channel: t.channel, level: t.level, status: t.status, solvedBy: t.status === 'solved' ? t.solvedBy : null,
      amount: t.amount ?? null, createdAt: t.createdAt, helpdesk: `${t.helpdesk} ${t.helpdeskId}`, outcome: t.result,
      steps: t.steps.map((s) => `${s.step} (${s.tool}): ${s.result}${s.detail ? ` - ${s.detail}` : ''}`),
    })),
    leads: app.leads.map((l) => ({
      id: l.id, name: l.name, company: l.company, need: l.need, channel: l.channel,
      score: l.score, value: l.value, stage: l.stage, hot: l.hot, createdAt: l.createdAt,
    })),
    pendingApprovals: app.approvals.pending.map((a) => ({
      id: a.id, ticket: a.ref, customer: a.customer, reason: a.reason, amount: a.amount ?? null,
      summary: a.summary, suggestion: a.suggestion, evidence: a.evidence, confidence: a.confidence,
    })),
    recentDecisions: app.approvals.history.slice(0, 5).map((a) => ({ id: a.id, ticket: a.ref, decision: a.decision, by: a.by, note: a.note ?? null })),
    agent: app.settings && { name: app.settings.agentName, autonomy: app.settings.autonomy },
  }), [app.tickets, app.leads, app.approvals, app.settings])

  useAgentContext({ description: 'Live ShopKart workspace data from the ResolveAI Control Room (tickets, leads, approvals)', value: snapshot })
  const page = useMemo(() => ({ path: pathname, now: new Date().toISOString() }), [pathname])
  useAgentContext({ description: `The Control Room page ${OWNER.first} is looking at, and the current time`, value: page })
  useAgentContext({ description: 'Who is asking: the signed-in user, the owner and only person running the business. Address them by first name.', value: OWNER })

  /* ── Generative UI ── */

  useFrontendTool({
    name: 'show_ticket',
    description: 'Show one support ticket as a live card: status, level, channel, customer, amount, the tools Aria used and the outcome.',
    parameters: z.object({ ticketId: z.string().describe('Ticket id (the Zendesk number), e.g. 2041') }),
    handler: async ({ ticketId }) => {
      const t = live.current.tickets.find((x) => x.id.toLowerCase() === ticketId.toLowerCase())
      return t ? `Card shown for ${t.id} (${t.status}). ${t.result ?? ''}` : `No ticket ${ticketId}. Tell the user it does not exist.`
    },
    render: card(TicketCard),
  })

  useFrontendTool({
    name: 'show_tickets',
    description: 'Show a filtered list of tickets as a live card. Omit a filter to include everything.',
    parameters: z.object({
      status: STATUS.optional().describe('open, in_progress, waiting (for a human) or solved'),
      level: LEVEL.optional(),
      channel: CHANNEL.optional(),
      solvedBy: z.enum(['ai', 'human']).optional().describe('Only solved tickets, by who solved them'),
      limit: z.number().int().min(1).max(12).optional(),
    }),
    handler: async (f) => {
      const n = live.current.tickets.filter((t) =>
        (!f.status || t.status === f.status) && (!f.level || t.level === f.level) && (!f.channel || t.channel === f.channel) &&
        (!f.solvedBy || (t.status === 'solved' && t.solvedBy === f.solvedBy))).length
      return `Card shown with ${Math.min(n, f.limit || 8)} of ${n} matching tickets.`
    },
    render: card(TicketListCard),
  })

  useFrontendTool({
    name: 'show_approvals',
    description: 'Show actions waiting for a human decision, with Approve and Reject buttons the user can press. Pass an approval id (AP-…) or ticket id to show just one.',
    parameters: z.object({ approvalId: z.string().optional().describe('Approval id (AP-…) or ticket id (the Zendesk number)') }),
    handler: async () => `Card shown with ${live.current.approvals.pending.length} pending approvals. The user decides in the card; do not claim anything was approved.`,
    render: card(ApprovalsCard),
  })

  useFrontendTool({
    name: 'show_metrics',
    description: 'Show the 14-day KPIs (queries, share solved by AI, escalations, average solve time) and the daily AI vs human volume chart.',
    parameters: z.object({}),
    handler: async () => {
      const s = live.current.stats
      if (!s) return 'Card shown, but the stats have not loaded yet.'
      const ai = s.daily.ai.reduce((a, b) => a + b, 0)
      const human = s.daily.human.reduce((a, b) => a + b, 0)
      if (ai + human === 0) return 'Card shown. There are no queries in the last 14 days yet.'
      return `Card shown. 14 days: ${ai + human} queries, ${ai} solved by AI (${((ai / (ai + human)) * 100).toFixed(1)}%), ${s.escalated.value} escalated, avg solve ${s.solveTime.seconds}s, ${s.hotLeads.value} hot leads. Changes vs previous 14 days (%): ${JSON.stringify(s.deltas)}.`
    },
    render: card(MetricsCard),
  })

  useFrontendTool({
    name: 'show_lead',
    description: 'Show one sales lead as a live card: company, need, deal value, stage, score and what Aria did.',
    parameters: z.object({ leadId: z.string().describe('Lead id (the CRM deal id), e.g. 12') }),
    handler: async ({ leadId }) => {
      const l = live.current.leads.find((x) => x.id.toLowerCase() === leadId.toLowerCase())
      return l ? `Card shown for ${l.id}.` : `No lead ${leadId}. Tell the user it does not exist.`
    },
    render: card(LeadCard),
  })

  /* ── Actions ── */

  useFrontendTool({
    name: 'open_page',
    description: 'Open a page of the Control Room, optionally on one ticket. Use only when the user asks to go somewhere.',
    parameters: z.object({
      page: z.enum(Object.keys(PAGES)),
      ticketId: z.string().optional().describe('With page "tickets", open this ticket'),
    }),
    handler: async ({ page, ticketId }) => {
      navigate(page === 'tickets' && ticketId ? `/tickets?id=${ticketId}` : PAGES[page])
      return `Opened ${page}.`
    },
  })

  useConfigureSuggestions({
    available: 'before-first-message',
    suggestions: [
      { title: 'What needs me?', message: 'What is waiting for my approval right now?' },
      { title: 'How is Aria doing?', message: 'How has Aria performed over the last 14 days?' },
      { title: 'Latest ticket', message: 'What happened on the newest ticket, and what did Aria check?' },
      { title: 'Hottest lead', message: 'Which lead should sales call first, and why?' },
      { title: 'Sales pipeline', message: 'Show me the open pipeline and which deals are hot.' },
      { title: 'New campaign leads', message: 'Fetch new leads from our campaigns.' },
      { title: 'Refund rules', message: 'When does a refund need my approval?' },
    ],
  })

  return null
}
