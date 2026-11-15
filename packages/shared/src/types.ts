// The API contract shared by the mock API (P3) and the three demo screens (P1).
// Every shape the agent reads or writes is defined here once.

export const BOT = "ResolveAI Bot";

/* ───────────────────────── Zendesk ───────────────────────── */

export type TicketStatus = "new" | "open" | "pending" | "solved";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketType = "question" | "incident" | "problem";
export type TicketView = "all_unsolved" | "unassigned" | "assigned_humans" | "recently_solved";
export type TicketChannel = "chat" | "web" | "email" | "api";

/** Our agent's severity levels, accepted anywhere a priority is. */
export type AgentLevel = "low" | "medium" | "high" | "critical";

export const LEVEL_TO_PRIORITY: Record<AgentLevel, TicketPriority> = {
  low: "low",
  medium: "normal",
  high: "high",
  critical: "urgent",
};

/**
 * The one person running the business: the signed-in user in every app (Control Room, Zendesk, HubSpot),
 * the person tickets are handed to, who approves refunds, owns deals and hosts sales calls.
 */
export const OWNER = {
  name: "Kabir Malhotra",
  first: "Kabir",
  role: "Founder",
  business: "ShopKart",
  email: "kabir@shopkart.example",
} as const;

/** People a ticket can be handed to (besides the bot). Just the owner: a small business. */
export const SUPPORT_AGENTS = [OWNER.name] as const;

export interface ZdUser {
  id: number;
  name: string;
  email: string;
  phone: string;
}

export interface ZdComment {
  id: number;
  author: string;
  author_type: "customer" | "agent" | "bot";
  body: string;
  /** false = internal note (team only) */
  public: boolean;
  created_at: string;
}

export interface Ticket {
  id: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  requester: ZdUser;
  /** "ResolveAI Bot", a human agent, or null when unassigned */
  assignee: string | null;
  /** true when the bot handed this ticket to a human */
  escalated_by_ai: boolean;
  tags: string[];
  via: TicketChannel;
  order_id: number | null;
  csat: number | null;
  /** Criticality the ResolveAI main agent gave it (null for tickets it didn't triage) */
  level: AgentLevel | null;
  /** Which ResolveAI agent works it: low, medium or high, or human for critical ones */
  handled_by: "low" | "medium" | "high" | "human" | null;
  created_at: string;
  updated_at: string;
  comments: ZdComment[];
}

export type TicketSummary = Omit<Ticket, "comments"> & { comment_count: number };

export interface CreateTicketBody {
  subject: string;
  /** First message, posted as a public customer comment */
  comment?: string;
  requester_id?: number;
  requester?: Omit<ZdUser, "id">;
  status?: TicketStatus;
  priority?: TicketPriority | AgentLevel;
  type?: TicketType;
  assignee?: string | null;
  tags?: string[];
  via?: TicketChannel;
  order_id?: number | null;
}

export interface UpdateTicketBody {
  subject?: string;
  status?: TicketStatus;
  priority?: TicketPriority | AgentLevel;
  type?: TicketType;
  assignee?: string | null;
  tags?: string[];
  escalated_by_ai?: boolean;
  csat?: number | null;
  level?: AgentLevel | null;
  handled_by?: "low" | "medium" | "high" | "human" | null;
  /** "human" when a person changed it in the UI; anything else counts as the AI */
  actor?: "human" | "ai";
}

export interface CreateCommentBody {
  body: string;
  public: boolean;
  author?: string;
  author_type?: ZdComment["author_type"];
}

/* ───────────────────────── HubSpot CRM ───────────────────────── */

export type DealStage =
  | "new_lead"
  | "qualified"
  | "meeting_booked"
  | "quote_sent"
  | "closed_won"
  | "closed_lost";

export const DEAL_STAGES: { id: DealStage; label: string; probability: number }[] = [
  { id: "new_lead", label: "New lead", probability: 10 },
  { id: "qualified", label: "Qualified", probability: 30 },
  { id: "meeting_booked", label: "Meeting booked", probability: 50 },
  { id: "quote_sent", label: "Quote sent", probability: 80 },
  { id: "closed_won", label: "Closed won", probability: 100 },
  { id: "closed_lost", label: "Closed lost", probability: 0 },
];

export type LeadScore = "hot" | "warm" | "cold";
export type LeadStatus = "New" | "Open" | "In progress" | "Open deal" | "Unqualified" | "Connected";

/** People who can own a deal (besides the bot). */
export const SALES_REPS = [OWNER.name] as const;

export interface Contact {
  id: number;
  name: string;
  email: string;
  phone: string;
  company: string;
  lead_status: LeadStatus;
  owner: string;
  source: "Business enquiry form" | "Chat" | "Referral" | "Import" | "Campaign" | "Voice call";
  created_at: string;
}

export type ActivityType = "note" | "email" | "meeting" | "call" | "stage_change" | "quote";

export interface Activity {
  id: number;
  type: ActivityType;
  body: string;
  author: string;
  ai: boolean;
  created_at: string;
}

export interface Meeting {
  id: number;
  deal_id: number;
  title: string;
  start: string;
  duration_min: number;
  attendees: string[];
}

export type QuoteStatus = "draft" | "waiting_approval" | "sent";

export interface QuoteItem {
  name: string;
  qty: number;
  unit_price: number;
}

export interface Quote {
  items: QuoteItem[];
  amount: number;
  status: QuoteStatus;
  updated_at: string;
}

export interface Task {
  id: number;
  title: string;
  due: string;
  done: boolean;
}

export interface Deal {
  id: number;
  name: string;
  amount: number;
  stage: DealStage;
  contact_id: number;
  owner: string;
  score: LeadScore;
  next_step: string;
  close_date: string;
  meeting: Meeting | null;
  quote: Quote | null;
  payment_link: string | null;
  tasks: Task[];
  created_at: string;
  updated_at: string;
}

export type DealCard = Deal & { contact: Pick<Contact, "id" | "name" | "company"> };
export type DealDetail = Deal & { contact: Contact; activities: Activity[] };

export interface CreateContactBody {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  lead_status?: LeadStatus;
  owner?: string;
  source?: Contact["source"];
}

export interface CreateDealBody {
  name: string;
  amount: number;
  contact_id: number;
  stage?: DealStage;
  owner?: string;
  score?: LeadScore;
  next_step?: string;
  close_date?: string;
}

export interface UpdateDealBody {
  name?: string;
  amount?: number;
  stage?: DealStage;
  owner?: string;
  score?: LeadScore;
  next_step?: string;
  close_date?: string;
  payment_link?: string | null;
  actor?: "human" | "ai";
  /** who made a human change, for the activity log */
  author?: string;
}

export interface CreateNoteBody {
  body: string;
  type?: Exclude<ActivityType, "stage_change" | "quote">;
  author?: string;
  ai?: boolean;
}

export interface Slot {
  start: string;
  end: string;
}

export interface BookMeetingBody {
  deal_id: number;
  start: string;
  duration_min?: number;
  title?: string;
}

export interface SaveQuoteBody {
  items: QuoteItem[];
  status?: QuoteStatus;
}

/* ───────────────────────── ShopKart ───────────────────────── */

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  mrp: number;
  image: string;
  rating: number;
  reviews: number;
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  city: string;
}

export type OrderStatus = "placed" | "shipped" | "delivered" | "damaged";
export type PaymentStatus = "paid" | "cod" | "refunded" | "refund_initiated" | "failed_debited";

export interface OrderItem {
  product_id: number;
  name: string;
  image: string;
  qty: number;
  price: number;
}

export interface Order {
  id: number;
  customer_id: number;
  items: OrderItem[];
  amount: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  placed_at: string;
  updated_at: string;
}

export interface ChatRequest {
  session_id: string;
  customer_id: number;
  message: string;
  /** Set when the customer is answering a question Aria asked (ChatResponse.ask). */
  answer?: ChatAnswer;
}

export interface ChatResponse {
  reply: string;
  ticket_id?: number;
  /** Aria needs one more detail before it can act (e.g. which order). The chat shows it as a card to pick from. */
  ask?: ChatQuestion;
}

/** One choice in a ChatQuestion. For an order question, `value` is the order id. */
export interface ChatChoice {
  value: string;
  label: string;
  description?: string;
  /** Product image path, e.g. "/static/mug.jpg" */
  image?: string;
}

/**
 * A question Aria asks before it opens a ticket, because the request can't be worked without the answer
 * ("Item damaged" from someone with several orders). Code decides when to ask, never the model.
 */
export interface ChatQuestion {
  /** What the answer fills in. */
  kind: "order";
  prompt: string;
  description?: string;
  choices: ChatChoice[];
  /** A free-text answer besides the choices, e.g. an order number not in the list. */
  other?: { label: string; placeholder: string };
  /** The customer's original message, sent back with the answer so the request can be worked as a whole. */
  original: string;
}

export interface ChatAnswer {
  kind: ChatQuestion["kind"];
  /** The original message the question was about. */
  original: string;
  /** The picked choice's value, or null for a free-text answer. */
  value: string | null;
  /** What the customer sees as their reply: the choice's label or what they typed. */
  text: string;
}

export type EnquiryNeed = "bulk_order" | "billing_setup" | "payment_setup" | "other";

export const ENQUIRY_NEEDS: { id: EnquiryNeed; label: string }[] = [
  { id: "bulk_order", label: "Bulk order" },
  { id: "billing_setup", label: "Billing setup" },
  { id: "payment_setup", label: "Payment setup" },
  { id: "other", label: "Something else" },
];

export interface LeadRequest {
  name: string;
  phone: string;
  email: string;
  business_name: string;
  need: EnquiryNeed;
  budget: number;
  start_when: string;
}

export interface LeadResponse {
  ok: boolean;
  message: string;
  deal_id?: number;
}

/* ───────────────────────── Campaigns (lead sources) ───────────────────────── */

export type CampaignChannel = "meta_ads" | "google_ads" | "whatsapp" | "email";

export const CAMPAIGN_CHANNELS: { id: CampaignChannel; label: string }[] = [
  { id: "meta_ads", label: "Meta Ads" },
  { id: "google_ads", label: "Google Ads" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
];

export type CampaignStatus = "active" | "paused" | "ended";

export interface Campaign {
  id: number;
  name: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  /** ₹ */
  budget: number;
  /** ₹ spent so far */
  spend: number;
  impressions: number;
  clicks: number;
  started_at: string;
}

/** A campaign with counts of its responses by status. */
export type CampaignSummary = Campaign & { responses: number; new: number; converted: number; skipped: number };

export type CampaignResponseStatus = "new" | "converted" | "skipped";

/** One person who answered a campaign (lead form, WhatsApp reply, email reply). The leads agent turns these into CRM leads. */
export interface CampaignResponse {
  id: number;
  campaign: Pick<Campaign, "id" | "name" | "channel">;
  name: string;
  email: string;
  phone: string;
  company: string;
  need: EnquiryNeed;
  message: string;
  /** ₹, when they gave one */
  budget: number | null;
  start_when: string;
  status: CampaignResponseStatus;
  contact_id: number | null;
  deal_id: number | null;
  /** Why it was converted or skipped */
  note: string;
  created_at: string;
  processed_at: string | null;
}

export interface ConvertResponseBody {
  score: LeadScore;
  deal_name: string;
  /** ₹ */
  amount: number;
  next_step: string;
  /** For the deal timeline: why this lead, why this score */
  note: string;
}

export interface ConvertResponseResult {
  response: CampaignResponse;
  contact: Contact;
  deal: Deal;
  /** true when the email already had a CRM contact, which was reused */
  existing_contact: boolean;
}

export interface SkipResponseBody {
  reason: string;
}

export interface LeadSyncRequest {
  /** Most responses to process in one run (default 10) */
  limit?: number;
}

export interface LeadSyncResult {
  response_id: number;
  name: string;
  company: string;
  campaign: string;
  outcome: "converted" | "skipped" | "failed";
  deal_id?: number;
  score?: LeadScore;
  reason: string;
}

export interface LeadSyncResponse {
  processed: number;
  converted: number;
  skipped: number;
  failed: number;
  /** New responses still waiting after this run */
  remaining: number;
  results: LeadSyncResult[];
}

/* ───────────────────────── Analytics ───────────────────────── */

export type AnalyticsDatasetId =
  | "tickets_per_day"
  | "tickets_by_status"
  | "tickets_by_priority"
  | "orders_per_day"
  | "orders_by_status"
  | "deals_by_stage"
  | "pipeline_by_score"
  | "campaign_performance"
  | "contacts_by_source";

/** The charts the analytics page draws. The analysis agent can only write findings about these. */
export const ANALYTICS_DATASETS: { id: AnalyticsDatasetId; title: string; description: string }[] = [
  { id: "tickets_per_day", title: "Tickets per day", description: "Tickets opened per day over the last 14 days, split into handled by the AI and handled by people" },
  { id: "tickets_by_status", title: "Tickets by status", description: "Every ticket by its current status" },
  { id: "tickets_by_priority", title: "Tickets by priority", description: "Every ticket by priority" },
  { id: "orders_per_day", title: "Orders per day", description: "ShopKart orders and revenue (₹) per day over the last 14 days" },
  { id: "orders_by_status", title: "Orders by status", description: "ShopKart orders by delivery status, with refunds" },
  { id: "deals_by_stage", title: "Pipeline by stage", description: "CRM deals and their value (₹) per pipeline stage" },
  { id: "pipeline_by_score", title: "Open pipeline by lead score", description: "Open deals (not closed won/lost) and their value (₹) by hot, warm, cold" },
  { id: "campaign_performance", title: "Campaign performance", description: "Per campaign: spend (₹), clicks, responses and leads created" },
  { id: "contacts_by_source", title: "Contacts by source", description: "CRM contacts by where they came from" },
];

/** The charts that are about sales: what the Sales area shows and what a sales-scoped analysis may write about. */
export const SALES_DATASETS: AnalyticsDatasetId[] = ["deals_by_stage", "pipeline_by_score", "campaign_performance", "contacts_by_source"];

/** What an analysis covers: everything (Analytics page) or just sales (Sales area). */
export type AnalysisScope = "all" | "sales";

export type AnalyticsUnit = "count" | "inr";

export interface AnalyticsSeries {
  key: string;
  label: string;
  unit: AnalyticsUnit;
}

export interface AnalyticsDataset {
  id: AnalyticsDatasetId;
  title: string;
  description: string;
  series: AnalyticsSeries[];
  /** One row per category or day. `label` is the x-axis value; series keys hold the numbers. */
  rows: ({ key: string; label: string } & Record<string, string | number>)[];
}

export interface AnalyticsTotals {
  tickets: number;
  tickets_open: number;
  tickets_solved: number;
  /** Tickets still with the AI (assigned to the bot, never escalated) */
  tickets_ai: number;
  /** Tickets the AI handed to a person. A different set from tickets_ai, not a part of it. */
  tickets_escalated: number;
  /** 0–100 */
  ai_rate: number;
  orders_14d: number;
  revenue_14d: number;
  refunds: number;
  deals_open: number;
  pipeline_open: number;
  won_value: number;
  hot_open: number;
  campaign_spend: number;
  campaign_responses: number;
  campaign_leads: number;
  /** ₹ spend per lead created, null before the first lead */
  cost_per_lead: number | null;
}

export interface AnalyticsMetrics {
  generated_at: string;
  totals: AnalyticsTotals;
  datasets: AnalyticsDataset[];
}

export type InsightTone = "good" | "watch" | "risk";

export interface AnalysisInsight {
  dataset: AnalyticsDatasetId;
  title: string;
  finding: string;
  tone: InsightTone;
}

export interface AnalysisReport {
  id: number;
  scope: AnalysisScope;
  headline: string;
  insights: AnalysisInsight[];
  /** ResolveAI Bot for the agent, "Rules" for the built-in stand-in */
  author: string;
  /** The totals the findings were written against */
  snapshot: AnalyticsTotals;
  created_at: string;
}

export interface CreateReportBody {
  /** Default "all". A "sales" report may only have findings about SALES_DATASETS. */
  scope?: AnalysisScope;
  headline: string;
  insights: AnalysisInsight[];
  author?: string;
}

export interface AnalysisRequest {
  /** Optional question to focus the analysis, e.g. "Which campaign should get more budget?" */
  focus?: string;
  /** Default "all" */
  scope?: AnalysisScope;
}

export interface AnalysisResponse {
  report: AnalysisReport;
}

/* ───────────────────────── Policies (ShopKart's business rules) ───────────────────────── */

export type PolicyArea =
  | "returns"
  | "refunds"
  | "damaged_items"
  | "cancellations"
  | "shipping"
  | "payments"
  | "cod"
  | "warranty"
  | "exchanges"
  | "address_changes"
  | "price_protection"
  | "compensation"
  | "fraud"
  | "service_levels"
  | "privacy"
  | "store_credit"
  | "bulk_orders";

export type PolicyStatus = "active" | "draft" | "retired";

/**
 * What a rule means for whoever applies it:
 * auto = the AI may act on its own · allow = permitted, no action needed · require = permitted once a condition is met
 * (evidence, details) · approval = a person (approver) must approve first · escalate = hand to a team · deny = not allowed ·
 * info = a fact to tell the customer (timelines, fees).
 */
export type PolicyEffect = "auto" | "allow" | "require" | "approval" | "escalate" | "deny" | "info";

/** When a rule applies. Every field is optional; a rule applies when all the fields it has match. Amounts in ₹. */
export interface PolicyConditions {
  /** Product categories as in the shop: Audio, Wearables, Cameras, Accessories, Bags, Home, Fashion */
  categories?: string[];
  /** Item tags that change the rule, e.g. "innerwear", "personalised", "gift_card" */
  tags?: string[];
  order_status?: OrderStatus[];
  payment?: ("prepaid" | "cod")[];
  /** Order (or refund) amount, inclusive */
  min_amount?: number;
  max_amount?: number;
  /** Customer reasons it covers, e.g. "change_of_mind", "defective", "wrong_item", "damaged_in_transit" */
  reasons?: string[];
  channels?: string[];
}

export type PolicyParams = Record<string, string | number | boolean | string[] | number[]>;

export interface Policy {
  /** Stable code, e.g. "POL-RET" */
  code: string;
  area: PolicyArea;
  title: string;
  /** Internal summary for the team and the agents */
  summary: string;
  /** What we may tell customers, word for word */
  customer_text: string;
  /** Team that owns the policy */
  owner: string;
  version: number;
  status: PolicyStatus;
  effective_from: string;
  updated_at: string;
}

export interface PolicyRule {
  /** Stable code, e.g. "REF-AUTO-AI" */
  code: string;
  policy_code: string;
  title: string;
  description: string;
  conditions: PolicyConditions;
  effect: PolicyEffect;
  /** Limits, windows, fees, timelines: whatever the rule needs */
  params: PolicyParams;
  /** Role that approves or receives it (approval / escalate rules) */
  approver: string | null;
  /** Lower runs first when several rules match */
  priority: number;
  active: boolean;
}

export type PolicyWithRules = Policy & { rules: PolicyRule[] };

export interface ApiError {
  error: string;
}
