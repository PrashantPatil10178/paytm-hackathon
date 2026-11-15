// Single data access layer. Most pages still read mock JSON; Analytics and Campaigns read the live demo
// API (Postgres) through /api, which vite proxies to API_URL. Pages never import JSON or fetch directly.
import tickets from './data/tickets.json'
import leads from './data/leads.json'
import approvals from './data/approvals.json'
import stats from './data/stats.json'
import integrations from './data/integrations.json'
import workspace from './data/workspace.json'
import { api as http, usePoll } from '@ph/shared/react'

// Mock timestamps are anchored to this moment. We shift them so the newest
// event always looks like it happened a minute ago, whenever the demo runs.
const DEMO_NOW = new Date('2026-11-14T15:30:00+05:30').getTime()
const OFFSET = Date.now() - DEMO_NOW
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

function freshen(value) {
  if (Array.isArray(value)) return value.map(freshen)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freshen(v)]))
  }
  if (typeof value === 'string' && ISO.test(value)) {
    return new Date(new Date(value).getTime() + OFFSET).toISOString()
  }
  return value
}

const respond = (data, ms = 250) =>
  new Promise((resolve) => setTimeout(() => resolve(freshen(data)), ms))

export const api = {
  getTickets: () => respond(tickets),
  getLeads: () => respond(leads),
  getApprovals: () => respond(approvals),
  getStats: () => respond(stats),
  getChannels: () => respond({ channels: integrations.channels, catalog: integrations.channelCatalog }),
  getConnectors: () => respond({ connectors: integrations.connectors, catalog: integrations.catalog }),
  getTeamTasks: () => respond(workspace.team),
  getSettings: () => respond(workspace.settings),

  // Write operations: no-ops for now, they just resolve so the UI flow is real.
  updateTicketStatus: (id, status) => respond({ id, status, ok: true }, 120),
  decideApproval: (id, decision, note) => respond({ id, decision, note, ok: true }, 200),
  saveSettings: (settings) => respond({ ok: true, settings }, 400),
  connect: (id) => respond({ id, ok: true }, 1100),

  // Live: the agents. Each waits for the model, so these take seconds (the lead sync up to a few minutes).
  runAnalysis: (focus) => http.post('/analysis', focus ? { focus } : {}),
  syncCampaignLeads: (limit = 10) => http.post('/campaigns/sync', { limit }),
}

/** Live, polled reads from the demo API. Identical payloads keep the same object, so idle pages don't re-render. */
export const live = {
  useMetrics: () => usePoll('/analytics/metrics', 5000),
  useLatestReport: () => usePoll('/analytics/reports/latest', 5000),
  useCampaigns: () => usePoll('/campaigns', 4000),
  useResponses: (status) => usePoll(`/campaigns/responses${status ? `?status=${status}` : ''}`, 4000),
}
