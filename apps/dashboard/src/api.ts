// Single data access layer. Everything is live: reads poll the demo API (Postgres) through /api, which
// vite proxies to API_URL; writes are real requests. Pages never fetch directly.
import { ApiRequestError, api as http, usePoll } from '@ph/shared/react'
import type {
  AnalysisReport, AnalysisResponse, AnalysisScope, AnalyticsMetrics, Call, CampaignResponse, CampaignResponseStatus, CampaignSummary,
  CreateInfoRequestBody, DealCard, DealDetail, DealStage, InfoForm, InfoRequest, LeadSyncResponse, PlaceCallBody, SupportCallBody, PolicyArea,
  PolicyEffect, PolicyWithRules, TicketSummary, UpdateInfoFormBody, VoiceCall, VoiceLine,
} from '@ph/shared'
import type {
  Approvals, ChannelConnection, ChannelId, ChannelOffer, ChatDetail, ChatThread, Connector, ConnectorOffer, Conversation, Decision, Lead, Settings, Stats, Status,
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
  /** A reply from the Chats inbox. The first one takes the chat over from Aria (its ticket is assigned to you). */
  sendChatMessage: (id: string, body: string) => http.post<ChatDetail>(`/control-room/chats/${encodeURIComponent(id)}/messages`, { body }),
  handBackChat: (id: string) => http.post<ChatDetail>(`/control-room/chats/${encodeURIComponent(id)}/handback`, {}),
  solveChat: (id: string) => http.post<ChatDetail>(`/control-room/chats/${encodeURIComponent(id)}/solve`, {}),
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
  placeCall: (body: PlaceCallBody | SupportCallBody | { deal_id: number; phone?: string; name?: string; business_name?: string }) =>
    http.post<Call>('/resolveai/calls', body),
  /** The ShopKart customer who raised a Zendesk ticket (its requester) and the order it is about. */
  ticketCustomer: (ticketId: string) =>
    http.get<{ requester: { id: number; name: string }; order_id: number | null }>(`/zendesk/tickets/${encodeURIComponent(ticketId)}`)
      .then((t) => ({ customerId: t.requester.id, name: t.requester.name, orderId: t.order_id ?? null })),
  /** What the Support Caller would be told about this customer and ticket (its customer_context). */
  callContext: (customerId: number, ticketId: string, orderId: number | null) =>
    http.get<{ customer_context: string; order_id: number | null; language: string }>(
      `/resolveai/calls/context?customer_id=${customerId}&ticket_id=${encodeURIComponent(ticketId)}${orderId ? `&order_id=${orderId}` : ''}`,
    ),
  syncCall: (id: number) => http.post<Call>(`/resolveai/calls/${id}/sync`, {}),

  // Policies (read-only). `q` matches any word, best first.
  policies: (q?: string) => http.get<{ policies: PolicyWithRules[] }>(`/policies${q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),

  // The agents. Each waits for the model, so these take seconds (the lead sync up to a few minutes).
  runAnalysis: (focus?: string, scope: AnalysisScope = 'all') => http.post<AnalysisResponse>('/analysis', { scope, ...(focus ? { focus } : {}) }),
  syncCampaignLeads: (limit = 10) => http.post<LeadSyncResponse>('/campaigns/sync', { limit }),

  // Live: request forms (Support › Request forms).
  updateForm: (id: string, changes: UpdateInfoFormBody) => http.patch<InfoForm>(`/info/forms/${id}`, changes),
  sendForm: (body: CreateInfoRequestBody) => http.post<InfoRequest>('/info/requests', body),
  withdrawForm: (id: number) => http.post<InfoRequest>(`/info/requests/${id}/withdraw`, {}),
}

/** Live, polled reads from the demo API. Identical payloads keep the same object, so idle pages don't re-render. */
export const live = {
  // Control Room records. The store polls tickets, leads, approvals, settings and stats once for every page.
  useTickets: () => usePoll<{ tickets: Ticket[] }>('/control-room/tickets', 3000),
  /** Chats Aria answered directly, without a ticket (low-level questions). */
  useConversations: () => usePoll<{ conversations: Conversation[] }>('/control-room/conversations', 3000),
  /** Every support chat, newest activity first (the Chats inbox). */
  useChats: (on = true) => usePoll<{ chats: ChatThread[] }>(on ? '/control-room/chats' : null, 2000),
  /** One chat's messages; null id = nothing to poll. */
  useChat: (id: string | null) => usePoll<ChatDetail>(id ? `/control-room/chats/${encodeURIComponent(id)}` : null, 2000),
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

  /** ShopKart's business policies with their rules (read-only). `q` matches any word, best first. Pass `on = false` to skip. */
  usePolicies: (f: { area?: PolicyArea | null; q?: string | null; effect?: PolicyEffect | null } = {}, on = true) => {
    const qs = new URLSearchParams()
    if (f.area) qs.set('area', f.area)
    if (f.q?.trim()) qs.set('q', f.q.trim())
    if (f.effect) qs.set('effect', f.effect)
    const s = qs.toString()
    return usePoll<{ policies: PolicyWithRules[] }>(on ? `/policies${s ? `?${s}` : ''}` : null, 30000)
  },

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
  /** The Sarvam phone line: number, setup and today's counts. Pass false to skip. */
  useVoiceLine: (enabled = true) => usePoll<VoiceLine>(enabled ? '/voice/line' : null, 3000),
  /** Calls to the phone line, newest first (transcripts arrive when a call ends). */
  useVoiceCalls: () => usePoll<{ calls: VoiceCall[] }>('/voice/calls', 2000),
  /** The request forms the team set up. */
  useInfoForms: () => usePoll<{ forms: InfoForm[] }>('/info/forms', 5000),
  /** Forms sent into customers' chats, newest first. Pass false to skip. */
  useInfoRequests: (enabled = true) => usePoll<{ requests: InfoRequest[] }>(enabled ? '/info/requests' : null, 2500),
  /** Unsolved Zendesk tickets (the real helpdesk, not the mock list): where a person can send a form. */
  useOpenTickets: () => usePoll<{ tickets: TicketSummary[] }>('/zendesk/tickets?view=all_unsolved', 4000),
}

/** A readable message from a failed request. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
