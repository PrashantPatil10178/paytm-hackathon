/**
 * Typed client for the tools the agents act in. Each call goes to its connector's base URL (Zendesk,
 * ShopKart + Paytm, HubSpot), as configured on the Control Room's Connectors page, with that
 * connector's token. A connector that is turned off refuses every call.
 */
import type {
  AttachmentWithReuse,
  ChatTranscript,
  Product,
  AnalysisReport,
  AnalysisScope,
  AnalyticsMetrics,
  BookMeetingBody,
  ConnectorAccess,
  ConnectorId,
  CampaignResponse,
  Contact,
  ConvertResponseBody,
  ConvertResponseResult,
  CreateReportBody,
  CreateCommentBody,
  CreateContactBody,
  CreateDealBody,
  CreateInfoRequestBody,
  CreateNoteBody,
  CreateTicketBody,
  Customer,
  Deal,
  InfoForm,
  InfoRequest,
  Meeting,
  Order,
  Quote,
  SaveQuoteBody,
  SkipResponseBody,
  Slot,
  Ticket,
  TicketSummary,
  UpdateDealBody,
  UpdateTicketBody,
  ZdComment,
} from "@ph/shared";

export class DemoAPIError extends Error {
  constructor(
    /** HTTP status from the demo API, or 0 when it couldn't be reached */
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type DemoAPI = ReturnType<typeof createDemoAPI>;

/** The connectors this client calls. Sarvam (voice) is a connector too, but the demo API places calls, not this client. */
type ToolConnector = Exclude<ConnectorId, "sarvam">;
const PREFIX: Record<ToolConnector, string> = { zendesk: "/zendesk", shop: "/shop", hubspot: "/crm" };
const NAMES: Record<ToolConnector, string> = { zendesk: "Zendesk", shop: "ShopKart + Paytm", hubspot: "HubSpot CRM" };
const CACHE_MS = 10_000;

/**
 * `connectors` returns the live connector config (from the Control Room). Without it every connector
 * defaults to `${baseUrl}/zendesk`, `/shop` and `/crm`, which is what the tests use.
 */
/** The CRM contact a campaign response's email already belongs to (GET /campaigns/responses/{id}). */
export type KnownContact = Contact & { deals: Pick<Deal, "id" | "name" | "stage" | "amount">[] };

export function createDemoAPI(baseUrl: string, fetchImpl: typeof fetch = fetch, connectors?: () => Promise<ConnectorAccess[]>) {
  let cache: { at: number; list: ConnectorAccess[] } | null = null;

  // Campaigns and analytics are ResolveAI's own records in the demo API, not a connector.
  async function access(id: ToolConnector | undefined): Promise<ConnectorAccess> {
    if (!id) return { id: "zendesk", base_url: baseUrl, token: null, enabled: true };
    if (!connectors) return { id, base_url: `${baseUrl}${PREFIX[id]}`, token: null, enabled: true };
    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), list: await connectors() };
    const c = cache.list.find((x) => x.id === id);
    if (!c) throw new DemoAPIError(503, `The ${NAMES[id]} connector isn't set up in the Control Room`);
    return c;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const id = (Object.keys(PREFIX) as ToolConnector[]).find((k) => path.startsWith(`${PREFIX[k]}/`));
    const c = await access(id);
    const name = id ? NAMES[id] : "the demo API";
    if (!c.enabled) throw new DemoAPIError(503, `The ${name} connector is turned off in the Control Room`);
    const url = `${c.base_url.replace(/\/$/, "")}${id ? path.slice(PREFIX[id].length) : path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(c.token && { authorization: `Bearer ${c.token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new DemoAPIError(0, `Can't reach ${name} at ${c.base_url}: ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new DemoAPIError(res.status, data?.error ?? res.statusText);
    return data as T;
  }

  /** A binary GET through the path's connector (attachments): the bytes and their type. */
  async function raw(path: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const id = (Object.keys(PREFIX) as ToolConnector[]).find((k) => path.startsWith(`${PREFIX[k]}/`));
    const c = await access(id);
    if (!c.enabled) throw new DemoAPIError(503, `The ${id ? NAMES[id] : "demo API"} connector is turned off in the Control Room`);
    const url = `${c.base_url.replace(/\/$/, "")}${id ? path.slice(PREFIX[id].length) : path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { ...(c.token && { authorization: `Bearer ${c.token}` }) }, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new DemoAPIError(0, `Can't reach ${url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new DemoAPIError(res.status, res.statusText);
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/jpeg" };
  }

  return {
    // Shop
    customerOrders: (customerId: number) => call<{ customer: Customer; orders: Order[] }>("GET", `/shop/customers/${customerId}/orders`),
    order: (orderId: number) => call<Order>("GET", `/shop/orders/${orderId}`),
    refundOrder: (orderId: number) => call<Order>("POST", `/shop/orders/${orderId}/refund`),
    /** The catalogue (for product categories: POL-DMG has rules per category) */
    products: () => call<{ products: Product[] }>("GET", "/shop/products").then((r) => r.products),

    // Zendesk
    ticket: (ticketId: number) => call<Ticket>("GET", `/zendesk/tickets/${ticketId}`),
    createTicket: (body: CreateTicketBody) => call<Ticket>("POST", "/zendesk/tickets", body),
    updateTicket: (ticketId: number, changes: UpdateTicketBody) => call<Ticket>("PATCH", `/zendesk/tickets/${ticketId}`, changes),
    addComment: (ticketId: number, body: CreateCommentBody) => call<ZdComment>("POST", `/zendesk/tickets/${ticketId}/comments`, body),
    customerTickets: (customerId: number) => call<{ tickets: TicketSummary[] }>("GET", `/zendesk/users/${customerId}/tickets`).then((r) => r.tickets),
    /** Photos on a ticket, each with earlier uses of the same image elsewhere (sha256) */
    ticketAttachments: (ticketId: number) => call<{ attachments: AttachmentWithReuse[] }>("GET", `/zendesk/tickets/${ticketId}/attachments`).then((r) => r.attachments),
    /** One photo's bytes, for the vision check */
    attachmentData: (id: number) => raw(`/zendesk/attachments/${id}`),
    /** Phone the customer for the details a request is missing (Aria · Support Caller). The API records the step. */
    placeSupportCall: (b: { customer_id: number; ticket_id: number | null; session_id: string; run_id: number; reason: string; questions: string[]; order_id?: number | null }) =>
      call<{ id: number; status: string }>("POST", "/resolveai/calls", { purpose: "support", ...b }),
    /** The stored chat (ResolveAI's own record in the demo API): its newest ticket, e.g. one a person opened from the Control Room. */
    chatSession: (sessionId: string) => call<ChatTranscript>("GET", `/chat/sessions/${encodeURIComponent(sessionId)}`),

    // Request forms (details to collect from the customer in the chat)
    infoForms: () => call<{ forms: InfoForm[] }>("GET", "/info/forms"),
    createInfoRequest: (body: CreateInfoRequestBody) => call<InfoRequest>("POST", "/info/requests", body),

    // CRM
    createContact: (body: CreateContactBody) => call<Contact>("POST", "/crm/contacts", body),
    createDeal: (body: CreateDealBody) => call<Deal>("POST", "/crm/deals", body),
    updateDeal: (dealId: number, changes: UpdateDealBody) => call<Deal>("PATCH", `/crm/deals/${dealId}`, changes),
    addDealNote: (dealId: number, body: CreateNoteBody) => call<unknown>("POST", `/crm/deals/${dealId}/notes`, body),
    slots: () => call<{ slots: Slot[] }>("GET", "/crm/slots"),
    bookMeeting: (body: BookMeetingBody) => call<Meeting>("POST", "/crm/meetings", body),
    saveQuote: (dealId: number, body: SaveQuoteBody) => call<Quote>("POST", `/crm/deals/${dealId}/quote`, body),

    // Campaigns (the leads agent's input)
    newResponses: () => call<{ responses: CampaignResponse[] }>("GET", "/campaigns/responses?status=new"),
    campaignResponse: (id: number) => call<CampaignResponse & { existing_contact: KnownContact | null }>("GET", `/campaigns/responses/${id}`),
    convertResponse: (id: number, body: ConvertResponseBody) => call<ConvertResponseResult>("POST", `/campaigns/responses/${id}/convert`, body),
    skipResponse: (id: number, body: SkipResponseBody) => call<CampaignResponse>("POST", `/campaigns/responses/${id}/skip`, body),

    // Analytics (the analysis agent's input and output)
    metrics: () => call<AnalyticsMetrics>("GET", "/analytics/metrics"),
    reports: (scope?: AnalysisScope) => call<{ reports: AnalysisReport[] }>("GET", `/analytics/reports${scope ? `?scope=${scope}` : ""}`),
    saveReport: (body: CreateReportBody) => call<AnalysisReport>("POST", "/analytics/reports", body),
  };
}
