/** Rows → the API shapes in @ph/shared. The only real work is Date → ISO string. */
import type { Activity, AgentRun, Attachment, AnalysisReport, Call, Campaign, CampaignResponse, ChatMessage, AgentStep, Approval, Channel, Connector, ResolvedCase, Contact, Customer, Deal, InfoForm, InfoRequest, Meeting, Order, Product, Ticket, TicketSummary, ZdComment, ZdUser } from "@ph/shared";
import type * as s from "./schema.ts";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];
const iso = (d: Date) => d.toISOString();

export const toCustomer = (r: Row<typeof s.customers>): Customer => r;
export const toProduct = (r: Row<typeof s.products>): Product => r;
export const toZdUser = (r: Row<typeof s.zdUsers>): ZdUser => r;

export const toOrder = (r: Row<typeof s.orders>): Order => ({ ...r, placed_at: iso(r.placed_at), updated_at: iso(r.updated_at) });

export const toChatMessage = ({ customer_id: _, channel_id: __, ...r }: Row<typeof s.chatMessages>): ChatMessage => ({ ...r, created_at: iso(r.created_at) });

export const toComment = ({ ticket_id: _, ...r }: Row<typeof s.ticketComments>): ZdComment => ({ ...r, created_at: iso(r.created_at) });

type TicketRow = Row<typeof s.tickets> & { requester: Row<typeof s.zdUsers> };

export function toTicketSummary({ requester_id: _, requester, ...r }: TicketRow, comment_count: number): TicketSummary {
  return { ...r, requester: toZdUser(requester), created_at: iso(r.created_at), updated_at: iso(r.updated_at), comment_count };
}

export function toTicket(r: TicketRow & { comments: Row<typeof s.ticketComments>[] }): Ticket {
  const { comment_count: _, ...t } = toTicketSummary(r, r.comments.length);
  return { ...t, comments: [...r.comments].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id).map(toComment) };
}

export const toContact = (r: Row<typeof s.contacts>): Contact => ({ ...r, created_at: iso(r.created_at) });

export const toMeeting = (r: Row<typeof s.meetings>): Meeting => ({ ...r, start: iso(r.start) });

export function toDeal(r: Row<typeof s.deals> & { meeting: Row<typeof s.meetings> | null }): Deal {
  return {
    ...r,
    close_date: iso(r.close_date),
    meeting: r.meeting ? toMeeting(r.meeting) : null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export const toActivity = ({ deal_id: _, ...r }: Row<typeof s.activities>): Activity => ({ ...r, created_at: iso(r.created_at) });

/* ───── ResolveAI ───── */


const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export const toChannel = ({ token_hash: _, ...r }: Row<typeof s.channels>): Channel => ({
  ...r,
  last_used_at: isoOrNull(r.last_used_at),
  created_at: iso(r.created_at),
});

export const toConnector = ({ token, ...r }: Row<typeof s.connectors>): Connector => ({
  ...r,
  token_hint: token ? token.slice(-4) : null,
  last_checked_at: isoOrNull(r.last_checked_at),
});

export const toStep = (r: Row<typeof s.agentSteps>): AgentStep => ({ ...r, created_at: iso(r.created_at) });

export function toRun({ steps, ...r }: Row<typeof s.agentRuns> & { steps?: Row<typeof s.agentSteps>[] }): AgentRun {
  const run: AgentRun = { ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at) };
  if (steps) run.steps = [...steps].sort((a, b) => a.id - b.id).map(toStep);
  return run;
}

export const toApproval = (r: Row<typeof s.approvals>): Approval => ({
  ...r,
  created_at: iso(r.created_at),
  decided_at: isoOrNull(r.decided_at),
});

export const toCase = (r: Row<typeof s.resolvedCases>): ResolvedCase => ({ ...r, created_at: iso(r.created_at) });
export const toCampaign = (r: Row<typeof s.campaigns>): Campaign => ({ ...r, started_at: iso(r.started_at) });

type ResponseRow = Row<typeof s.campaignResponses> & { campaign: Pick<Row<typeof s.campaigns>, "id" | "name" | "channel"> };

export function toCampaignResponse({ campaign_id: _, campaign, ...r }: ResponseRow): CampaignResponse {
  return {
    ...r,
    campaign: { id: campaign.id, name: campaign.name, channel: campaign.channel },
    created_at: iso(r.created_at),
    processed_at: r.processed_at ? iso(r.processed_at) : null,
  };
}

export const toReport = (r: Row<typeof s.analysisReports>): AnalysisReport => ({ ...r, created_at: iso(r.created_at) });

export const toCall = (r: Row<typeof s.calls>): Call => ({
  ...r,
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
  ended_at: r.ended_at ? iso(r.ended_at) : null,
  continued_at: r.continued_at ? iso(r.continued_at) : null,
});

/** Attachment metadata (never the bytes). `url` is the API path that serves the image. */
export type AttachmentMeta = Omit<Row<typeof s.attachments>, "data">;
export const toAttachment = (r: AttachmentMeta): Attachment => ({
  id: r.id,
  url: `/attachments/${r.id}`,
  mime: r.mime,
  size: r.size,
  width: r.width,
  height: r.height,
  sha256: r.sha256,
  name: r.name,
  customer_id: r.customer_id,
  ticket_id: r.ticket_id,
  order_id: r.order_id,
  created_at: iso(r.created_at),
});
export const toInfoForm = ({ position: _, ...r }: Row<typeof s.infoForms>): InfoForm => ({ ...r, updated_at: iso(r.updated_at) });

export function toInfoRequest({ customer_id: _, ...r }: Row<typeof s.infoRequests>, customer: { id: number; name: string } | null): InfoRequest {
  return { ...r, customer, created_at: iso(r.created_at), answered_at: r.answered_at ? iso(r.answered_at) : null };
}
