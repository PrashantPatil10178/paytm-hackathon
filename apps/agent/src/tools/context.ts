import type { AnalysisReport, LeadScore } from "@ph/shared";
import type { ToolExecuteOptions } from "@voltagent/core";

/**
 * Per-request facts the service puts in the VoltAgent operation context. Tools read the ticket,
 * customer, deal and campaign response from here, never from model arguments, so the model can't
 * act on someone else's records.
 */
export interface SupportRun {
  ticketId: number;
  customerId: number;
}

export interface SalesRun {
  dealId: number;
  contactId: number;
}

/** One POST /analysis run. `report` is set by publish_report so the service can return it. */
export interface AnalysisRun {
  kind: "analysis";
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
