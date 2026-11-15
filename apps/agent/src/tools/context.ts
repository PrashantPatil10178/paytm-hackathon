import type { ToolExecuteOptions } from "@voltagent/core";

/**
 * Per-request facts the service puts in the VoltAgent operation context. Tools read the ticket,
 * customer and deal from here, never from model arguments, so the model can't act on someone
 * else's records.
 */
export interface SupportRun {
  ticketId: number;
  customerId: number;
}

export interface SalesRun {
  dealId: number;
  contactId: number;
}

const KEY = "resolveai.run";

export const runContext = (run: SupportRun | SalesRun) => ({ [KEY]: run });

export function runOf<T extends SupportRun | SalesRun>(opts: ToolExecuteOptions | undefined): T {
  const run = opts?.context?.get(KEY);
  if (!run) throw new Error("Tool called outside a /chat or /lead request");
  return run as T;
}
