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

export const SUPPORT_AGENTS = ["Priya – Support", "Karan – Support"] as const;

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

export const SALES_REPS = ["Rahul – Sales", "Meera – Sales"] as const;

export interface Contact {
  id: number;
  name: string;
  email: string;
  phone: string;
  company: string;
  lead_status: LeadStatus;
  owner: string;
  source: "Business enquiry form" | "Chat" | "Referral" | "Import";
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
}

export interface ChatResponse {
  reply: string;
  ticket_id?: number;
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

export interface ApiError {
  error: string;
}
