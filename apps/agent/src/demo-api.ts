/**
 * Typed client for the tools the agents act in. Each call goes to its connector's base URL (Zendesk,
 * ShopKart + Paytm, HubSpot), as configured on the Control Room's Connectors page, with that
 * connector's token. A connector that is turned off refuses every call.
 */
import type {
  BookMeetingBody,
  ConnectorAccess,
  ConnectorId,
  Contact,
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

const PREFIX: Record<ConnectorId, string> = { zendesk: "/zendesk", shop: "/shop", hubspot: "/crm" };
const NAMES: Record<ConnectorId, string> = { zendesk: "Zendesk", shop: "ShopKart + Paytm", hubspot: "HubSpot CRM" };
const CACHE_MS = 10_000;

/**
 * `connectors` returns the live connector config (from the Control Room). Without it every connector
 * defaults to `${baseUrl}/zendesk`, `/shop` and `/crm`, which is what the tests use.
 */
export function createDemoAPI(baseUrl: string, fetchImpl: typeof fetch = fetch, connectors?: () => Promise<ConnectorAccess[]>) {
  let cache: { at: number; list: ConnectorAccess[] } | null = null;

  async function access(id: ConnectorId): Promise<ConnectorAccess> {
    if (!connectors) return { id, base_url: `${baseUrl}${PREFIX[id]}`, token: null, enabled: true };
    if (!cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), list: await connectors() };
    const c = cache.list.find((x) => x.id === id);
    if (!c) throw new DemoAPIError(503, `The ${NAMES[id]} connector isn't set up in the Control Room`);
    return c;
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const id = (Object.keys(PREFIX) as ConnectorId[]).find((k) => path.startsWith(`${PREFIX[k]}/`))!;
    const c = await access(id);
    if (!c.enabled) throw new DemoAPIError(503, `The ${NAMES[id]} connector is turned off in the Control Room`);
    const url = `${c.base_url.replace(/\/$/, "")}${path.slice(PREFIX[id].length)}`;
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
      throw new DemoAPIError(0, `Can't reach ${NAMES[id]} at ${c.base_url}: ${(e as Error).message}`);
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
    customerTickets: (customerId: number) => call<{ tickets: TicketSummary[] }>("GET", `/zendesk/users/${customerId}/tickets`).then((r) => r.tickets),

    // CRM
    createContact: (body: CreateContactBody) => call<Contact>("POST", "/crm/contacts", body),
    createDeal: (body: CreateDealBody) => call<Deal>("POST", "/crm/deals", body),
    updateDeal: (dealId: number, changes: UpdateDealBody) => call<Deal>("PATCH", `/crm/deals/${dealId}`, changes),
    addDealNote: (dealId: number, body: CreateNoteBody) => call<unknown>("POST", `/crm/deals/${dealId}/notes`, body),
    slots: () => call<{ slots: Slot[] }>("GET", "/crm/slots"),
    bookMeeting: (body: BookMeetingBody) => call<Meeting>("POST", "/crm/meetings", body),
    saveQuote: (dealId: number, body: SaveQuoteBody) => call<Quote>("POST", `/crm/deals/${dealId}/quote`, body),
  };
}
