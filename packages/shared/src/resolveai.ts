/**
 * ResolveAI's own records: how messages get in (channels), which tools the agents may reach
 * (connectors), and what the agents did (runs, steps, approvals, resolved cases).
 * The demo API stores them in Postgres; the agent and the Control Room read and write them through it.
 */
import type { AgentLevel } from "./types.ts";

/* ───── Channels: where requests come from. The agent accepts a request only with the channel's token. ───── */

export type ChannelKind = "chat" | "voice" | "form" | "whatsapp" | "email" | "webchat" | "api";

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  enabled: boolean;
  /** Last 4 characters of the token, so people can tell tokens apart. The token itself is never returned. */
  token_hint: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** Returned once, when a token is created or rotated. */
export interface ChannelToken {
  channel: Channel;
  token: string;
}

/* ───── Connectors: the tools the agents act in, and how to reach them. ───── */

/** `sarvam` is the voice platform the agents place sales calls through (base URL + API key). */
export type ConnectorId = "zendesk" | "shop" | "hubspot" | "sarvam";
export type ConnectorStatus = "connected" | "error" | "disabled";

export interface Connector {
  id: ConnectorId;
  name: string;
  category: string;
  /** Where the agent sends this tool's API calls, e.g. http://localhost:4000/zendesk */
  base_url: string;
  enabled: boolean;
  token_hint: string | null;
  status: ConnectorStatus;
  last_checked_at: string | null;
  last_error: string | null;
}

/** What the agent gets: the connector including its token (never sent to the browser). */
export interface ConnectorAccess {
  id: ConnectorId;
  base_url: string;
  token: string | null;
  enabled: boolean;
}

export interface UpdateConnectorBody {
  base_url?: string;
  /** null clears it */
  token?: string | null;
  enabled?: boolean;
}

/* ───── Agent runs: one per incoming request. ───── */

/** Who works a ticket: the three level agents, or a person for critical ones. */
export type HandledBy = "low" | "medium" | "high" | "human";
export type RunKind = "request" | "status_check";
export type RunStatus = "triaging" | "working" | "waiting_approval" | "escalated" | "resolved" | "failed";
export type StepResult = "success" | "blocked" | "escalated";
export type StepAgent = "main" | HandledBy;

export interface AgentStep {
  id: number;
  run_id: number;
  agent: StepAgent;
  step: string;
  tool: string;
  result: StepResult;
  detail: string;
  created_at: string;
}

export interface AgentRun {
  id: number;
  channel_id: string;
  session_id: string;
  customer_id: number;
  ticket_id: number | null;
  kind: RunKind;
  message: string;
  intent: string | null;
  level: AgentLevel | null;
  /** Why the main agent picked that level, in plain words */
  level_reason: string | null;
  handled_by: HandledBy | null;
  status: RunStatus;
  /** The main agent's plan, one line per step */
  plan: string[];
  reply: string | null;
  created_at: string;
  updated_at: string;
  steps?: AgentStep[];
}

export interface CreateRunBody {
  channel_id: string;
  session_id: string;
  customer_id: number;
  message: string;
  kind?: RunKind;
}

export interface UpdateRunBody {
  ticket_id?: number | null;
  kind?: RunKind;
  intent?: string | null;
  level?: AgentLevel | null;
  level_reason?: string | null;
  handled_by?: HandledBy | null;
  status?: RunStatus;
  plan?: string[];
  reply?: string | null;
}

export interface CreateStepBody {
  agent: StepAgent;
  step: string;
  tool: string;
  result: StepResult;
  detail: string;
}

/* ───── Approvals: high-level actions wait for a person. ───── */

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Approval {
  id: number;
  run_id: number;
  ticket_id: number;
  /** What the high agent wants to do; only refunds today */
  action: "refund";
  order_id: number;
  amount: number;
  reason: string;
  summary: string;
  suggestion: string;
  status: ApprovalStatus;
  decided_by: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface CreateApprovalBody {
  run_id: number;
  ticket_id: number;
  action: "refund";
  order_id: number;
  amount: number;
  reason: string;
  summary: string;
  suggestion: string;
}

export interface DecideApprovalBody {
  decision: "approved" | "rejected";
  decided_by?: string;
  note?: string;
}

/* ───── Resolved cases: the main agent's memory of finished work. ───── */

export type CaseOutcome = "resolved" | "escalated" | "rejected";

export interface ResolvedCase {
  id: number;
  run_id: number;
  ticket_id: number | null;
  customer_id: number;
  intent: string;
  level: AgentLevel;
  handled_by: HandledBy;
  /** The problem in plain words, without personal details */
  problem: string;
  steps: string[];
  resolution: string;
  outcome: CaseOutcome;
  tags: string[];
  created_at: string;
}

export type CreateCaseBody = Omit<ResolvedCase, "id" | "created_at">;

/* ───── Voice calls (Sarvam): outbound calls by the Aria voice agents. ───── */

/**
 * sales = "Aria · Sales Caller" qualifies a lead; support = "Aria · Support Caller" phones a customer to
 * collect details a support request is missing, then the request continues in their chat.
 */
export type CallPurpose = "sales" | "support";
/** How a support call went (Sarvam `info_outcome`). */
export type InfoOutcome = "info_collected" | "partial" | "callback" | "declined" | "wrong_person" | "unclear";
export type CallStatus = "queued" | "ringing" | "in_progress" | "completed" | "no_answer" | "failed";
/** What the voice agent's post-call analysis decided (Sarvam `call_outcome`). */
export type CallOutcome = "meeting_booked" | "send_details" | "callback" | "not_interested" | "do_not_call" | "wrong_person" | "unclear";

/** The fields the Sarvam app extracts after a call. Any may be missing. */
export interface CallExtraction {
  call_outcome?: CallOutcome;
  lead_score?: "hot" | "warm" | "cold";
  need?: "bulk_order" | "billing_setup" | "payment_setup" | "other" | "not_discussed";
  start_when?: string;
  budget_inr?: number | null;
  is_decision_maker?: "yes" | "no" | "shared" | "not_discussed";
  whatsapp_ok?: boolean;
  score_reason?: string;
  contact_name_captured?: string;
  business_name_captured?: string;
  business_type?: string;
  city?: string;
  current_setup?: string;
  need_details?: string;
  monthly_volume?: string;
  email?: string;
  meeting_time?: string;
  objections?: string;
  call_summary?: string;
  /* Support calls */
  info_outcome?: InfoOutcome;
  order_number?: string;
  product?: string;
  issue_details?: string;
  wants?: "refund" | "replacement" | "return" | "cancel" | "delivery_update" | "information" | "other" | "not_discussed";
  best_time?: string;
  /** The main language the customer spoke, e.g. "Marathi" */
  language_used?: string;
}

export interface TranscriptLine {
  role: "agent" | "user";
  text: string;
}

export interface Call {
  id: number;
  provider: "sarvam";
  direction: "outbound";
  purpose: CallPurpose;
  status: CallStatus;
  /** E.164, e.g. +919876543210 */
  phone: string;
  name: string;
  business_name: string;
  /** The CRM records this call is about. A call placed from a deal has both; a cold call gets them when it ends. */
  contact_id: number | null;
  deal_id: number | null;
  /** Sarvam's id for the call / interaction */
  external_id: string | null;
  outcome: CallOutcome | null;
  lead_score: "hot" | "warm" | "cold" | null;
  extracted: CallExtraction;
  transcript: TranscriptLine[];
  summary: string | null;
  duration_s: number | null;
  error: string | null;
  /* Support calls: whose request, and where it continues */
  customer_id: number | null;
  ticket_id: number | null;
  /** The chat session the request came from; the answers go back into it */
  session_id: string | null;
  run_id: number | null;
  /** The language the call opened in (from the customer's state) */
  language: string | null;
  /** Why the call was placed, e.g. "the order the customer named isn't on their account" */
  reason: string | null;
  /** When the answers were handed back to the agent */
  continued_at: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

/** Ask Aria to phone a customer for the details a support request is missing. */
export interface SupportCallBody {
  purpose: "support";
  customer_id: number;
  /** Why we're calling, one plain clause, e.g. "you wrote that an item arrived damaged, but we couldn't tell which order" */
  reason: string;
  /** The details to collect, in order (1–3; calls stay short, extra ones are dropped) */
  questions: string[];
  ticket_id?: number | null;
  session_id?: string | null;
  run_id?: number | null;
  order_id?: number | null;
  /** Place it even outside 09:00–21:00 IST */
  force?: boolean;
}

export interface PlaceCallBody {
  phone: string;
  name: string;
  business_name?: string;
  /** Call about an existing CRM deal (its contact is used when phone/name are omitted) */
  deal_id?: number;
  /** Place it even outside 09:00–21:00 IST (never overrides the do-not-call list) */
  force?: boolean;
}

/* ───── Languages by place: the language a support call opens in ───── */

/** Indian languages the voice agents speak. They switch to whichever one the caller uses. */
export const CALL_LANGUAGES = ["English", "Hindi", "Bengali", "Gujarati", "Kannada", "Malayalam", "Marathi", "Odia", "Punjabi", "Tamil", "Telugu", "Assamese"] as const;
export type CallLanguage = (typeof CALL_LANGUAGES)[number];

/** State (or union territory) → its main language. States without one of CALL_LANGUAGES open in Hindi or English. */
const STATE_LANGUAGE: Record<string, CallLanguage> = {
  maharashtra: "Marathi", goa: "Marathi", karnataka: "Kannada", "tamil nadu": "Tamil", puducherry: "Tamil", kerala: "Malayalam",
  telangana: "Telugu", "andhra pradesh": "Telugu", "west bengal": "Bengali", tripura: "Bengali", gujarat: "Gujarati",
  punjab: "Punjabi", odisha: "Odia", assam: "Assamese", delhi: "Hindi", "uttar pradesh": "Hindi", "madhya pradesh": "Hindi",
  bihar: "Hindi", rajasthan: "Hindi", haryana: "Hindi", jharkhand: "Hindi", chhattisgarh: "Hindi", uttarakhand: "Hindi",
  "himachal pradesh": "Hindi", chandigarh: "Hindi", "jammu and kashmir": "Hindi",
};

/** Big cities → state, for addresses that only have a city. */
const CITY_STATE: Record<string, string> = {
  mumbai: "maharashtra", pune: "maharashtra", nagpur: "maharashtra", nashik: "maharashtra", thane: "maharashtra", aurangabad: "maharashtra",
  bengaluru: "karnataka", bangalore: "karnataka", mysuru: "karnataka", mysore: "karnataka", mangaluru: "karnataka", hubli: "karnataka",
  chennai: "tamil nadu", coimbatore: "tamil nadu", madurai: "tamil nadu", tiruchirappalli: "tamil nadu",
  kochi: "kerala", cochin: "kerala", thiruvananthapuram: "kerala", trivandrum: "kerala", kozhikode: "kerala", thrissur: "kerala",
  hyderabad: "telangana", warangal: "telangana", visakhapatnam: "andhra pradesh", vijayawada: "andhra pradesh",
  kolkata: "west bengal", howrah: "west bengal", siliguri: "west bengal", ahmedabad: "gujarat", surat: "gujarat", vadodara: "gujarat", rajkot: "gujarat",
  ludhiana: "punjab", amritsar: "punjab", jalandhar: "punjab", bhubaneswar: "odisha", cuttack: "odisha", guwahati: "assam",
  delhi: "delhi", "new delhi": "delhi", noida: "uttar pradesh", lucknow: "uttar pradesh", kanpur: "uttar pradesh", varanasi: "uttar pradesh",
  gurugram: "haryana", gurgaon: "haryana", jaipur: "rajasthan", indore: "madhya pradesh", bhopal: "madhya pradesh", patna: "bihar",
  ranchi: "jharkhand", raipur: "chhattisgarh", dehradun: "uttarakhand", chandigarh: "chandigarh", panaji: "goa",
};

/** The language to open a call in, from a state or a city ("Pune" → Marathi). English when unknown. */
export function languageFor(place: string | null | undefined): CallLanguage {
  const p = (place ?? "").trim().toLowerCase();
  if (!p) return "English";
  return STATE_LANGUAGE[p] ?? STATE_LANGUAGE[CITY_STATE[p] ?? ""] ?? "English";
}
