/**
 * The Control Room's view of the platform (apps/dashboard), as the demo API serves it under
 * /control-room/*. Built from the live Postgres records (Zendesk tickets, ResolveAI runs and steps,
 * CRM deals, approvals, channels, connectors, settings, board tasks); nothing here is mock data.
 * Timestamps are ISO strings. Ids are strings: tickets use the Zendesk number ("2041"), leads the CRM
 * deal id, approvals "AP-<id>".
 */

import type { Attachment, ChatMessage, ChatSender } from './types.ts'

/** Where a request came in. `chat` = ShopKart chat, `voice` = Sarvam calls, `form` = the business enquiry form. */
export type ChannelId = 'chat' | 'voice' | 'form' | 'whatsapp' | 'email' | 'webchat' | 'appchat' | 'api'
export type Level = 'low' | 'medium' | 'high' | 'critical'
export type Status = 'open' | 'in_progress' | 'waiting' | 'solved'
export type StepResult = 'success' | 'blocked' | 'escalated'
/**
 * Who solved a ticket. `ai` = Aria alone; `ai_approved` = Aria did the work after a person approved it in
 * Approvals (e.g. a refund above the limit); `human` = a person handled it.
 */
export type Solver = 'ai' | 'ai_approved' | 'human'

/** One thing the agent did, with the tool it used. */
export interface Step {
  step: string
  tool: string
  result: StepResult
  time: string
  detail: string
}

export interface Message {
  from: 'customer' | 'ai' | 'agent'
  time: string
  text: string
  /** Photos sent with it */
  attachments?: Attachment[]
}

export interface Ticket {
  id: string
  customer: { name: string; contact: string; city: string }
  issue: string
  channel: ChannelId
  level: Level
  status: Status
  solvedBy: Solver | null
  helpdesk: 'zendesk'
  helpdeskId: string
  amount?: number | null
  createdAt: string
  conversation: Message[]
  steps: Step[]
  result: string
}

/**
 * A chat Aria answered directly, without a Zendesk ticket (low-level requests: where is my order, delivery times,
 * policy questions, "which order?" questions, status checks answered from an earlier answer). One per ResolveAI
 * run with no ticket. If the chat later needs a person, a ticket is opened then and shows up under tickets.
 */
export interface Conversation {
  /** "C-<run id>" */
  id: string
  customer: { name: string; contact: string; city: string }
  channel: ChannelId
  /** What the customer asked, as they wrote it (trimmed) */
  issue: string
  /** The main agent's one-line reading of it; '' when it wasn't triaged */
  summary: string
  /** Null for messages that weren't triaged into a level (out of scope, "which order?") */
  level: Level | null
  /** 'request' = a question; 'status_check' = asked again about an earlier answer */
  kind: 'request' | 'status_check'
  createdAt: string
  /** When Aria answered */
  answeredAt: string
  conversation: Message[]
  steps: Step[]
  /** The chat it came from, for the Chats inbox */
  sessionId: string
  /** Aria's answer */
  result: string
}

/**
 * One support chat in the Control Room's Chats inbox: every ShopKart chat, with or without a ticket. Aria answers
 * until a person replies from the inbox; then the chat is theirs (its ticket is assigned to them) until they hand
 * it back or solve it. The messages are the same rows the shop's chat widget shows.
 */
export interface ChatThread {
  /** The chat session id */
  id: string
  customer: { id: number; name: string; contact: string; city: string }
  channel: ChannelId
  /** The newest message that isn't a notice */
  last: { sender: ChatSender; author: string; body: string; at: string } | null
  startedAt: string
  updatedAt: string
  /** Messages, not counting notices */
  count: number
  /** The chat's newest ticket */
  ticket: { id: number; status: 'new' | 'open' | 'pending' | 'solved'; assignee: string | null; subject: string } | null
  /** `human` while a person owns the open ticket: Aria stays quiet and the customer's messages go to them. */
  handler: 'ai' | 'human'
  /** That person */
  agent: string | null
  /** The customer wrote last and a person owns the chat: they are waiting on a reply. */
  waiting: boolean
}

export interface ChatDetail {
  chat: ChatThread
  messages: ChatMessage[]
}

export interface Lead {
  id: string
  name: string
  company: string
  need: string
  /** Where the enquiry came in; 'manual' when someone added it in the Control Room. */
  channel: ChannelId | 'manual'
  score: number
  value: number
  stage: string
  hot: boolean
  createdAt: string
  steps: Step[]
}

/** An action the agent paused on because it crossed a guardrail. */
export interface Approval {
  id: string
  ref: string
  kind: 'ticket' | 'lead'
  reason: string
  tone: 'amber' | 'red' | 'indigo'
  customer: string
  amount?: number | null
  summary: string
  suggestion: string
  evidence: string[]
  confidence: number
  createdAt: string
  /** Photos on the ticket (damage claims) */
  photos?: Attachment[]
  /** Aria's checks behind it: "Check photo" (vision verdict) and "Check risk" (refund history), newest per kind */
  checks?: { step: string; result: StepResult; detail: string }[]
}

export type Decision = 'approved' | 'rejected'

export type DecidedApproval = Pick<Approval, 'id' | 'ref' | 'reason' | 'customer' | 'amount'> &
  Partial<Approval> & { decision: Decision; by: string; note?: string; decidedAt: string }

export interface Approvals {
  pending: Approval[]
  history: DecidedApproval[]
}

export type Autonomy = 'suggest' | 'approval' | 'autonomous'

/**
 * Aria's settings (Control Room → Aria → Settings). Every field changes what the agents do; see the Settings
 * page for one line each. Money and risk rules stay in code: no toggle turns off a refund limit or an approval.
 */
export interface Settings {
  /** The name Aria uses with customers (every agent's instructions, the chat author) */
  agentName: string
  /** Aria's avatar colour in the Control Room */
  avatarColor: string
  /** Tone of voice, in every agent's instructions */
  tone: string
  /** Off: that agent doesn't act (support chats go to the owner with a ticket; enquiries are logged in the CRM unscored) */
  playbooks: { support: boolean; sales: boolean }
  /** suggest: every refund waits for approval · approval: refunds within limits on clean cases, the rest wait · autonomous: also refunds within limits when a photo check is only unclear */
  autonomy: Autonomy
  /** ₹ Aria may refund alone */
  refundLimit: number
  /** Photo-verified damage claims (verified photo, no risk signal) may be refunded alone up to this ₹ (≥ refundLimit to matter) */
  verifiedDamageLimit: number
  /** On: every damage claim needs a photo; off: only where POL-DMG asks (orders above ₹1,000) */
  requireDamagePhotos: boolean
  /** Always to a person when on. fraud / legal: those mentions; vip: lifetime spend ≥ ₹15,000; negative: upset twice in a row or upset with 2+ recent tickets */
  escalation: { fraud: boolean; legal: boolean; vip: boolean; negative: boolean }
  /** Aria replies in the customer's language when it is one of these, else in the first one */
  languages: string[]
  /** Outside these hours (IST) Aria works in the afterHours mode and tells customers when a person is back */
  hours: { days: string[]; from: string; to: string; afterHours: Autonomy }
}

export interface Spark {
  value: number
  spark: number[]
}

export interface Stats {
  /** Per IST day: solved/handled by Aria alone, by Aria after a person's approval, by a person */
  daily: { ai: number[]; aiApproved: number[]; human: number[] }
  deltas: { queries: number; aiRate: number; escalated: number; solveTime: number; hotLeads: number }
  escalated: Spark
  solveTime: { seconds: number; spark: number[] }
  hotLeads: Spark
  byChannel: { channel: ChannelId; count: number }[]
  byLevel: { level: Level; count: number }[]
}

export interface ChannelConnection {
  /** The ResolveAI channel id (rai_channels), e.g. "shopkart" */
  id: string
  kind: ChannelId
  name: string
  desc: string
  handle: string
  connected: boolean
  enabled: boolean
  messagesToday: number
  avgResponse: string
}

export interface ChannelOffer {
  id: string
  name: string
  desc: string
}

export interface ConnectorOffer {
  id: string
  name: string
  category: string
  color: string
  capabilities: string[]
}

export interface Connector extends ConnectorOffer {
  status: string
  primary?: boolean
  lastSync: string
  actionsToday: number
}

export interface TeamTask {
  id: string
  /** Order inside its column */
  position: number
  title: string
  owner: string
  tag: string
  column: 'todo' | 'doing' | 'done'
}
