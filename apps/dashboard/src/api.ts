// Single data access layer. Most pages still read mock JSON; Analytics and Campaigns read the live demo
// API (Postgres) through /api, which vite proxies to API_URL. Pages never import JSON or fetch directly.
import ticketsJson from './data/tickets.json'
import leadsJson from './data/leads.json'
import approvalsJson from './data/approvals.json'
import statsJson from './data/stats.json'
import integrations from './data/integrations.json'
import workspace from './data/workspace.json'
import { api as http, usePoll } from '@ph/shared/react'
import type {
  AnalysisReport, AnalysisResponse, AnalysisScope, AnalyticsMetrics, CampaignResponse, CampaignResponseStatus, CampaignSummary,
  DealCard, DealDetail, DealStage, LeadSyncResponse,
} from '@ph/shared'
import type {
  Approvals, ChannelConnection, ChannelOffer, Connector, ConnectorOffer, Decision, Lead, Settings, Stats, Status,
  TeamTask, Ticket,
} from './types'

// JSON imports type their strings as `string`; these casts pin them to the unions in types.ts.
const tickets = ticketsJson as Ticket[]
const leads = leadsJson as Lead[]
const approvals = approvalsJson as Approvals
const stats = statsJson as Stats

// Mock timestamps are anchored to this moment. We shift them so the newest
// event always looks like it happened a minute ago, whenever the demo runs.
const DEMO_NOW = new Date('2026-11-14T15:30:00+05:30').getTime()
const OFFSET = Date.now() - DEMO_NOW
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function freshen<T>(value: T): T {
  if (Array.isArray(value)) return value.map(freshen) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freshen(v)])) as T
  }
  if (typeof value === 'string' && ISO.test(value)) {
    return new Date(new Date(value).getTime() + OFFSET).toISOString() as T
  }
  return value
}

const respond = <T,>(data: T, ms = 250): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(freshen(data)), ms))

export const api = {
  getTickets: () => respond(tickets),
  getLeads: () => respond(leads),
  getApprovals: () => respond(approvals),
  getStats: () => respond(stats),
  getChannels: () =>
    respond({ channels: integrations.channels as ChannelConnection[], catalog: integrations.channelCatalog as ChannelOffer[] }),
  getConnectors: () =>
    respond({ connectors: integrations.connectors as Connector[], catalog: integrations.catalog as ConnectorOffer[] }),
  getTeamTasks: () => respond(workspace.team as TeamTask[]),
  getSettings: () => respond(workspace.settings as Settings),

  // Write operations: no-ops for now, they just resolve so the UI flow is real.
  updateTicketStatus: (id: string, status: Status) => respond({ id, status, ok: true }, 120),
  decideApproval: (id: string, decision: Decision, note?: string) => respond({ id, decision, note, ok: true }, 200),
  saveSettings: (settings: Settings) => respond({ ok: true, settings }, 400),
  connect: (id: string) => respond({ id, ok: true }, 1100),

  // Live: the agents. Each waits for the model, so these take seconds (the lead sync up to a few minutes).
  runAnalysis: (focus?: string, scope: AnalysisScope = 'all') => http.post<AnalysisResponse>('/analysis', { scope, ...(focus ? { focus } : {}) }),
  syncCampaignLeads: (limit = 10) => http.post<LeadSyncResponse>('/campaigns/sync', { limit }),
}

/** Live, polled reads from the demo API. Identical payloads keep the same object, so idle pages don't re-render. */
export const live = {
  useMetrics: () => usePoll<AnalyticsMetrics>('/analytics/metrics', 5000),
  /** The newest report of that scope ("sales" for the Sales area). */
  useLatestReport: (scope: AnalysisScope = 'all') => usePoll<{ report: AnalysisReport | null }>(`/analytics/reports/latest?scope=${scope}`, 5000),
  /** The real CRM pipeline (HubSpot look-alike), not the mock leads. */
  useDeals: () => usePoll<{ stages: { id: DealStage; label: string; probability: number }[]; deals: DealCard[] }>('/crm/deals', 5000),
  /** One CRM deal with its contact and activity timeline. Pass null to skip. */
  useDeal: (id: number | null) => usePoll<DealDetail>(id == null ? null : `/crm/deals/${id}`, 5000),
  useCampaigns: () => usePoll<{ campaigns: CampaignSummary[] }>('/campaigns', 4000),
  /** All responses when `status` is omitted. */
  useResponses: (status?: CampaignResponseStatus) =>
    usePoll<{ responses: CampaignResponse[] }>(`/campaigns/responses${status ? `?status=${status}` : ''}`, 4000),
}
