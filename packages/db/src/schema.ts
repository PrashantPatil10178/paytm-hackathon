/**
 * The demo platform's tables. Column names match the API types in @ph/shared, so rows map onto them
 * almost one to one (see ./map.ts). Enum-like columns are text typed with the shared unions; the API
 * validates values before writing.
 */
import type {
  ActivityType,
  AnalysisInsight,
  AnalysisScope,
  AnalyticsTotals,
  CampaignChannel,
  CampaignResponseStatus,
  CampaignStatus,
  Contact,
  DealStage,
  EnquiryNeed,
  LeadScore,
  LeadStatus,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  Quote,
  Task,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  TicketType,
  ZdComment,
} from "@ph/shared";
import { relations } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

const id = () => integer().primaryKey().generatedByDefaultAsIdentity();
const at = () => timestamp({ withTimezone: true, mode: "date" });
const money = () => doublePrecision().notNull();

/* ───── ShopKart ───── */

export const customers = pgTable("customers", {
  id: id(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull(),
  city: text().notNull(),
});

export const products = pgTable("products", {
  id: id(),
  name: text().notNull(),
  category: text().notNull(),
  price: money(),
  mrp: money(),
  image: text().notNull(),
  rating: real().notNull(),
  reviews: integer().notNull(),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    customer_id: integer().notNull().references(() => customers.id),
    items: jsonb().$type<OrderItem[]>().notNull(),
    amount: money(),
    status: text().$type<OrderStatus>().notNull(),
    payment_status: text().$type<PaymentStatus>().notNull(),
    placed_at: at().notNull(),
    updated_at: at().notNull(),
  },
  (t) => [index().on(t.customer_id)],
);

/* ───── Zendesk ───── */

/** Ticket requesters. Ids 101–105 are the ShopKart customers. */
export const zdUsers = pgTable("zd_users", {
  id: id(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull(),
});

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    subject: text().notNull(),
    status: text().$type<TicketStatus>().notNull(),
    priority: text().$type<TicketPriority>().notNull(),
    type: text().$type<TicketType>().notNull(),
    requester_id: integer().notNull().references(() => zdUsers.id),
    assignee: text(),
    escalated_by_ai: boolean().notNull().default(false),
    tags: text().array().notNull().default([]),
    via: text().$type<TicketChannel>().notNull(),
    order_id: integer(),
    csat: integer(),
    created_at: at().notNull(),
    updated_at: at().notNull(),
  },
  (t) => [index().on(t.requester_id), index().on(t.status)],
);

export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: id(),
    ticket_id: integer().notNull().references(() => tickets.id, { onDelete: "cascade" }),
    author: text().notNull(),
    author_type: text().$type<ZdComment["author_type"]>().notNull(),
    body: text().notNull(),
    public: boolean().notNull(),
    created_at: at().notNull(),
  },
  (t) => [index().on(t.ticket_id)],
);

/** The built-in stand-in agent's chat session → ticket map (the real agent keeps its own). */
export const chatSessions = pgTable("chat_sessions", {
  session_id: text().primaryKey(),
  ticket_id: integer().notNull().references(() => tickets.id, { onDelete: "cascade" }),
});

/* ───── HubSpot CRM ───── */

export const contacts = pgTable("contacts", {
  id: id(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull(),
  company: text().notNull(),
  lead_status: text().$type<LeadStatus>().notNull(),
  owner: text().notNull(),
  source: text().$type<Contact["source"]>().notNull(),
  created_at: at().notNull(),
});

export const deals = pgTable(
  "deals",
  {
    id: id(),
    name: text().notNull(),
    amount: money(),
    stage: text().$type<DealStage>().notNull(),
    contact_id: integer().notNull().references(() => contacts.id),
    owner: text().notNull(),
    score: text().$type<LeadScore>().notNull(),
    next_step: text().notNull(),
    close_date: at().notNull(),
    quote: jsonb().$type<Quote>(),
    payment_link: text(),
    tasks: jsonb().$type<Task[]>().notNull().default([]),
    created_at: at().notNull(),
    updated_at: at().notNull(),
  },
  (t) => [index().on(t.contact_id)],
);

/** One booked call per deal. */
export const meetings = pgTable("meetings", {
  id: id(),
  deal_id: integer().notNull().unique().references(() => deals.id, { onDelete: "cascade" }),
  title: text().notNull(),
  start: at().notNull(),
  duration_min: integer().notNull(),
  attendees: text().array().notNull(),
});

export const activities = pgTable(
  "deal_activities",
  {
    id: id(),
    deal_id: integer().notNull().references(() => deals.id, { onDelete: "cascade" }),
    type: text().$type<ActivityType>().notNull(),
    body: text().notNull(),
    author: text().notNull(),
    ai: boolean().notNull(),
    created_at: at().notNull(),
  },
  (t) => [index().on(t.deal_id)],
);

/* ───── Campaigns (lead sources for the leads agent) ───── */

export const campaigns = pgTable("campaigns", {
  id: id(),
  name: text().notNull(),
  channel: text().$type<CampaignChannel>().notNull(),
  status: text().$type<CampaignStatus>().notNull(),
  budget: money(),
  spend: money(),
  impressions: integer().notNull(),
  clicks: integer().notNull(),
  started_at: at().notNull(),
});

/** People who answered a campaign. The leads agent converts each into a CRM contact + deal, or skips it. */
export const campaignResponses = pgTable(
  "campaign_responses",
  {
    id: id(),
    campaign_id: integer().notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    name: text().notNull(),
    email: text().notNull(),
    phone: text().notNull(),
    company: text().notNull(),
    need: text().$type<EnquiryNeed>().notNull(),
    message: text().notNull(),
    budget: doublePrecision(),
    start_when: text().notNull(),
    status: text().$type<CampaignResponseStatus>().notNull().default("new"),
    contact_id: integer().references(() => contacts.id, { onDelete: "set null" }),
    deal_id: integer().references(() => deals.id, { onDelete: "set null" }),
    note: text().notNull().default(""),
    created_at: at().notNull(),
    processed_at: at(),
  },
  (t) => [index().on(t.campaign_id), index().on(t.status)],
);

/* ───── Analytics ───── */

/** Reports written by the analysis agent (or the API's rule-based stand-in). */
export const analysisReports = pgTable("analysis_reports", {
  id: id(),
  scope: text().$type<AnalysisScope>().notNull().default("all"),
  headline: text().notNull(),
  insights: jsonb().$type<AnalysisInsight[]>().notNull(),
  author: text().notNull(),
  snapshot: jsonb().$type<AnalyticsTotals>().notNull(),
  created_at: at().notNull(),
});

/* ───── Relations (for db.query.*.findMany({ with })) ───── */

export const customersRelations = relations(customers, ({ many }) => ({ orders: many(orders) }));
export const ordersRelations = relations(orders, ({ one }) => ({ customer: one(customers, { fields: [orders.customer_id], references: [customers.id] }) }));
export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  requester: one(zdUsers, { fields: [tickets.requester_id], references: [zdUsers.id] }),
  comments: many(ticketComments),
}));
export const ticketCommentsRelations = relations(ticketComments, ({ one }) => ({ ticket: one(tickets, { fields: [ticketComments.ticket_id], references: [tickets.id] }) }));
export const contactsRelations = relations(contacts, ({ many }) => ({ deals: many(deals) }));
export const dealsRelations = relations(deals, ({ one, many }) => ({
  contact: one(contacts, { fields: [deals.contact_id], references: [contacts.id] }),
  meeting: one(meetings),
  activities: many(activities),
}));
export const meetingsRelations = relations(meetings, ({ one }) => ({ deal: one(deals, { fields: [meetings.deal_id], references: [deals.id] }) }));
export const campaignsRelations = relations(campaigns, ({ many }) => ({ responses: many(campaignResponses) }));
export const campaignResponsesRelations = relations(campaignResponses, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignResponses.campaign_id], references: [campaigns.id] }),
}));
export const activitiesRelations = relations(activities, ({ one }) => ({ deal: one(deals, { fields: [activities.deal_id], references: [deals.id] }) }));

/** Every demo table, children first: the order `reset` truncates in. */
export const DEMO_TABLES = ["analysis_reports", "campaign_responses", "campaigns", "chat_sessions", "ticket_comments", "tickets", "zd_users", "deal_activities", "meetings", "deals", "contacts", "orders", "products", "customers"] as const;
