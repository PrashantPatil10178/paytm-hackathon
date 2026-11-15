// Shapes of the Control Room's data, as src/api.ts returns it. Timestamps are ISO strings.
// The dashboard runs on mock JSON (src/data/) today; keep these in step with it, and with the
// live API when api.ts is wired to it.

export type ChannelId = 'whatsapp' | 'email' | 'webchat' | 'appchat'
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
  helpdesk: 'zendesk' | 'freshdesk'
  helpdeskId: string
  amount?: number | null
  createdAt: string
  conversation: Message[]
  steps: Step[]
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
  id: string
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
  title: string
  owner: string
  tag: string
  column: 'todo' | 'doing' | 'done'
}

export interface Toast {
  id: string
  tone: 'success' | 'neutral'
  title: string
  desc?: string
  action?: { label: string; onClick: () => void }
}
