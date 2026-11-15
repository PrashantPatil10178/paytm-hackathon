// Single data access layer. Everything is live: reads poll the demo API (Postgres) through /api, which
// vite proxies to API_URL; writes are real requests. Pages never fetch directly.
import { ApiRequestError, api as http, usePoll } from '@ph/shared/react'
import type {
  AnalysisReport, AnalysisResponse, AnalysisScope, AnalyticsMetrics, Call, CampaignResponse, CampaignResponseStatus, CampaignSummary,
  DealCard, DealDetail, DealStage, LeadSyncResponse, PlaceCallBody,
} from '@ph/shared'
import type {
  Approvals, ChannelConnection, ChannelId, ChannelOffer, Connector, ConnectorOffer, Conversation, Decision, Lead, Settings, Stats, Status,
  TeamTask, Ticket,
} from './types'
import type { Channel, ChannelToken } from '@ph/shared'

/** PUT and DELETE, which the shared client doesn't have. Same error shape as `http`. */
async function send<T>(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : undefined
  if (!res.ok) throw new ApiRequestError(data?.error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

export type LeadPatch = Partial<Pick<Lead, 'stage' | 'value' | 'name' | 'company'>>
export type TaskPatch = Partial<Pick<TeamTask, 'title' | 'owner' | 'tag' | 'column' | 'position'>>
export interface ChannelsPayload { channels: ChannelConnection[]; catalog: ChannelOffer[] }
export interface ConnectorsPayload { connectors: Connector[]; catalog: ConnectorOffer[] }

export const api = {
  // Support
  updateTicketStatus: (id: string, status: Status) =>
    http.patch<{ ticket: Ticket }>(`/control-room/tickets/${encodeURIComponent(id)}`, { status }),
  decideApproval: (id: string, decision: Decision, note?: string) =>
    http.post<{ ok: boolean; warning?: string }>(`/control-room/approvals/${encodeURIComponent(id)}/decide`, { decision, ...(note ? { note } : {}) }),

  // Sales
  updateLead: (id: string, patch: LeadPatch) => http.patch<{ lead: Lead }>(`/control-room/leads/${encodeURIComponent(id)}`, patch),

  // Aria
  saveSettings: (settings: Settings) => send<Settings>('PUT', '/control-room/settings', settings),

  // Connect. Channels and connectors are ResolveAI records (/resolveai/*); the Control Room views add stats.
  createChannel: (name: string, kind: ChannelId) =>
    http.post<{ channel: ChannelConnection; token: string }>('/control-room/channels', { name, kind }),
  setChannelEnabled: (id: string, enabled: boolean) => http.patch<Channel>(`/resolveai/channels/${encodeURIComponent(id)}`, { enabled }),
  rotateChannelToken: (id: string) => http.post<ChannelToken>(`/resolveai/channels/${encodeURIComponent(id)}/token`, {}),
  setConnectorEnabled: (id: string, enabled: boolean) => http.patch<unknown>(`/resolveai/connectors/${encodeURIComponent(id)}`, { enabled }),
  checkConnector: (id: string) => http.post<unknown>(`/resolveai/connectors/${encodeURIComponent(id)}/check`, {}),

  // Team board
  addTask: (task: { title: string; owner?: string; tag?: string; column?: TeamTask['column'] }) =>
    http.post<{ task: TeamTask }>('/control-room/board', task),
  updateTask: (id: string, patch: TaskPatch) => http.patch<{ task: TeamTask }>(`/control-room/board/${encodeURIComponent(id)}`, patch),
  deleteTask: (id: string) => send<unknown>('DELETE', `/control-room/board/${encodeURIComponent(id)}`),

  // Voice calls (Sarvam). Placing one rings a real phone.
  placeCall: (body: PlaceCallBody | { deal_id: number; phone?: string; name?: string; business_name?: string }) =>
    http.post<Call>('/resolveai/calls', body),
  syncCall: (id: number) => http.post<Call>(`/resolveai/calls/${id}/sync`, {}),

  // The agents. Each waits for the model, so these take seconds (the lead sync up to a few minutes).
  runAnalysis: (focus?: string, scope: AnalysisScope = 'all') => http.post<AnalysisResponse>('/analysis', { scope, ...(focus ? { focus } : {}) }),
  syncCampaignLeads: (limit = 10) => http.post<LeadSyncResponse>('/campaigns/sync', { limit }),
}

/** Live, polled reads from the demo API. Identical payloads keep the same object, so idle pages don't re-render. */
export const live = {
  // Control Room records. The store polls tickets, leads, approvals, settings and stats once for every page.
  useTickets: () => usePoll<{ tickets: Ticket[] }>('/control-room/tickets', 3000),
  /** Chats Aria answered directly, without a ticket (low-level questions). */
  useConversations: () => usePoll<{ conversations: Conversation[] }>('/control-room/conversations', 3000),
  useLeads: () => usePoll<{ leads: Lead[] }>('/control-room/leads', 3000),
  useApprovals: () => usePoll<Approvals>('/control-room/approvals', 3000),
  useStats: () => usePoll<Stats>('/control-room/stats', 5000),
  useSettings: () => usePoll<Settings>('/control-room/settings', 10000),
  /** Pass `on = false` to skip polling (the hook still has to be called). */
  useChannels: (every = 5000, on = true) => usePoll<ChannelsPayload>(on ? '/control-room/channels' : null, every),
  useConnectors: (every = 5000, on = true) => usePoll<ConnectorsPayload>(on ? '/control-room/connectors' : null, every),
  useBoard: () => usePoll<{ tasks: TeamTask[] }>('/control-room/board', 3000),
  /** Voice calls, newest first. */
  useCalls: () => usePoll<{ calls: Call[] }>('/resolveai/calls', 3000),

  useMetrics: () => usePoll<AnalyticsMetrics>('/analytics/metrics', 5000),
  /** The newest report of that scope ("sales" for the Sales area). */
  useLatestReport: (scope: AnalysisScope = 'all') => usePoll<{ report: AnalysisReport | null }>(`/analytics/reports/latest?scope=${scope}`, 5000),
  /** The real CRM pipeline (HubSpot look-alike). */
  useDeals: () => usePoll<{ stages: { id: DealStage; label: string; probability: number }[]; deals: DealCard[] }>('/crm/deals', 5000),
  /** One CRM deal with its contact and activity timeline. Pass null to skip. */
  useDeal: (id: number | null) => usePoll<DealDetail>(id == null ? null : `/crm/deals/${id}`, 5000),
  useCampaigns: () => usePoll<{ campaigns: CampaignSummary[] }>('/campaigns', 4000),
  /** All responses when `status` is omitted. */
  useResponses: (status?: CampaignResponseStatus) =>
    usePoll<{ responses: CampaignResponse[] }>(`/campaigns/responses${status ? `?status=${status}` : ''}`, 4000),
}

/** A readable message from a failed request. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
