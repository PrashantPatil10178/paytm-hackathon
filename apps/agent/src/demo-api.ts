/** Typed client for the demo API (apps/api). The agents' tools act only through this. */
import type {
  AnalysisReport,
  AnalyticsMetrics,
  BookMeetingBody,
  CampaignResponse,
  Contact,
  ConvertResponseBody,
  ConvertResponseResult,
  CreateReportBody,
  CreateCommentBody,
  CreateContactBody,
  CreateDealBody,
  CreateNoteBody,
  CreateTicketBody,
  Customer,
  Deal,
  Meeting,
  Order,
  Quote,
  SaveQuoteBody,
  SkipResponseBody,
  Slot,
  Ticket,
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

/** The CRM contact a campaign response's email already belongs to (GET /campaigns/responses/{id}). */
export type KnownContact = Contact & { deals: Pick<Deal, "id" | "name" | "stage" | "amount">[] };

export function createDemoAPI(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new DemoAPIError(0, `Can't reach the demo API at ${baseUrl}: ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new DemoAPIError(res.status, data?.error ?? res.statusText);
    return data as T;
  }

  return {
    // Shop
    customerOrders: (customerId: number) => call<{ customer: Customer; orders: Order[] }>("GET", `/shop/customers/${customerId}/orders`),
    order: (orderId: number) => call<Order>("GET", `/shop/orders/${orderId}`),
    refundOrder: (orderId: number) => call<Order>("POST", `/shop/orders/${orderId}/refund`),

    // Zendesk
    ticket: (ticketId: number) => call<Ticket>("GET", `/zendesk/tickets/${ticketId}`),
    createTicket: (body: CreateTicketBody) => call<Ticket>("POST", "/zendesk/tickets", body),
    updateTicket: (ticketId: number, changes: UpdateTicketBody) => call<Ticket>("PATCH", `/zendesk/tickets/${ticketId}`, changes),
    addComment: (ticketId: number, body: CreateCommentBody) => call<ZdComment>("POST", `/zendesk/tickets/${ticketId}/comments`, body),

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
    reports: () => call<{ reports: AnalysisReport[] }>("GET", "/analytics/reports"),
    saveReport: (body: CreateReportBody) => call<AnalysisReport>("POST", "/analytics/reports", body),
  };
}
