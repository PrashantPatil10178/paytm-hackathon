/**
 * The Control Room's view of the platform (apps/dashboard), as the demo API serves it under
 * /control-room/*. Built from the live Postgres records (Zendesk tickets, ResolveAI runs and steps,
 * CRM deals, approvals, channels, connectors, settings, board tasks); nothing here is mock data.
 * Timestamps are ISO strings. Ids are strings: tickets use the Zendesk number ("2041"), leads the CRM
 * deal id, approvals "AP-<id>".
 */

/** Where a request came in. `chat` = ShopKart chat, `voice` = Sarvam calls, `form` = the business enquiry form. */
export type ChannelId = 'chat' | 'voice' | 'form' | 'whatsapp' | 'email' | 'webchat' | 'appchat' | 'api'
export type Level = 'low' | 'medium' | 'high' | 'critical'
export type Status = 'open' | 'in_progress' | 'waiting' | 'solved'
export type StepResult = 'success' | 'blocked' | 'escalated'
export type Solver = 'ai' | 'human'

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
  /** Aria's answer */
  result: string
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
}

export type Decision = 'approved' | 'rejected'

export type DecidedApproval = Pick<Approval, 'id' | 'ref' | 'reason' | 'customer' | 'amount'> &
  Partial<Approval> & { decision: Decision; by: string; note?: string; decidedAt: string }

export interface Approvals {
  pending: Approval[]
  history: DecidedApproval[]
}

export type Autonomy = 'suggest' | 'approval' | 'autonomous'

export interface Settings {
  agentName: string
  avatarColor: string
  tone: string
  playbooks: { support: boolean; sales: boolean }
  autonomy: Autonomy
  refundLimit: number
  escalation: Record<string, boolean>
  languages: string[]
  hours: { days: string[]; from: string; to: string; afterHours: Autonomy }
}

export interface Spark {
  value: number
  spark: number[]
}

export interface Stats {
  daily: { ai: number[]; human: number[] }
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
