/** Rows → the API shapes in @ph/shared. The only real work is Date → ISO string. */
import type { Activity, AnalysisReport, Campaign, CampaignResponse, Contact, Customer, Deal, InfoForm, InfoRequest, Meeting, Order, Product, Ticket, TicketSummary, ZdComment, ZdUser } from "@ph/shared";
import type * as s from "./schema.ts";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];
const iso = (d: Date) => d.toISOString();

export const toCustomer = (r: Row<typeof s.customers>): Customer => r;
export const toProduct = (r: Row<typeof s.products>): Product => r;
export const toZdUser = (r: Row<typeof s.zdUsers>): ZdUser => r;

export const toOrder = (r: Row<typeof s.orders>): Order => ({ ...r, placed_at: iso(r.placed_at), updated_at: iso(r.updated_at) });

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

export const toInfoForm = ({ position: _, ...r }: Row<typeof s.infoForms>): InfoForm => ({ ...r, updated_at: iso(r.updated_at) });

export function toInfoRequest({ customer_id: _, ...r }: Row<typeof s.infoRequests>, customer: { id: number; name: string } | null): InfoRequest {
  return { ...r, customer, created_at: iso(r.created_at), answered_at: r.answered_at ? iso(r.answered_at) : null };
}
