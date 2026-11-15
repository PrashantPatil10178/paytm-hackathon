import type { AnalysisReport, AnalysisScope, LeadScore } from "@ph/shared";
import type { ToolExecuteOptions } from "@voltagent/core";

/**
 * Per-request facts the service puts in the VoltAgent operation context. Tools read the ticket,
 * customer, deal and campaign response from here, never from model arguments, so the model can't
 * act on someone else's records.
 */
export interface SupportRun {
  /** The request's Zendesk ticket; null while a low-level chat is answered without one */
  ticketId: number | null;
  customerId: number;
  /** The ResolveAI run this request belongs to (steps and approvals hang off it) */
  runId: number;
  /** Which level agent is working: low, medium or high */
  agent: "low" | "medium" | "high";
  /**
   * Orders a refund or approval may be about: ones the customer named in the chat, the ticket's order, or
   * their only order. Set by the service in code; the money tools refuse every other order.
   */
  orderIds: number[];
  /** The main agent's intent: damaged_item makes the refund and approval tools check photos and risk first */
  intent?: string;
  /** What the customer said, for the photo check */
  claim?: string;
  /** The damage-claim assessment made in this run (evidence.ts), so the tools agree on one verdict */
  damage?: import("../evidence.ts").DamageAssessment;
  /** Opens the ticket when a ticketless chat has to go to a person (the service attaches the conversation). */
  openTicket?: () => Promise<number>;
  /** The ticket being opened, so two tool calls never open two tickets */
  opening?: Promise<number>;
  /** "voice": a phone call (the inbound phone line), where request forms can't be shown */
  channel?: "chat" | "voice";
}

/** The request's ticket, opening it first when the chat had none (only a ticketless low chat can lack one). */
export async function ticketOf(run: SupportRun): Promise<number> {
  if (run.ticketId) return run.ticketId;
  if (!run.openTicket) throw new Error("This request has no ticket");
  run.opening ??= run.openTicket();
  run.ticketId = await run.opening;
  return run.ticketId;
}

export interface SalesRun {
  dealId: number;
  contactId: number;
  /** Set by book_meeting: from then on the deal stays in Meeting booked. */
  meetingBooked?: boolean;
}

/** One POST /analysis run. `report` is set by publish_report so the service can return it. */
export interface AnalysisRun {
  kind: "analysis";
  /** "sales": the tools show only sales datasets and publish_report accepts only findings about them */
  scope: AnalysisScope;
  report?: AnalysisReport;
}

/** One campaign response being worked by the leads agent. `outcome` is set by create_lead / skip_response. */
export interface LeadsRun {
  kind: "leads";
  responseId: number;
  /** ₹ the person gave on the form; the deal amount always comes from here, never from the model */
  budget: number;
  outcome?: { outcome: "converted"; dealId: number; score: LeadScore; reason: string } | { outcome: "skipped"; reason: string };
}

type Run = SupportRun | SalesRun | AnalysisRun | LeadsRun;

const KEY = "resolveai.run";

export const runContext = (run: Run) => ({ [KEY]: run });

export function runOf<T extends Run>(opts: ToolExecuteOptions | undefined): T {
  const run = opts?.context?.get(KEY);
  if (!run) throw new Error("Tool called outside a /chat, /lead, /analysis or /campaigns/sync request");
  return run as T;
}
