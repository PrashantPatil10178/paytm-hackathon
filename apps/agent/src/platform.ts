/**
 * Client for ResolveAI's own records in the demo API (/resolveai/*): channel tokens, connector
 * config, runs, steps, approvals and the resolved-case memory.
 */
import type {
  AgentRun,
  AgentStep,
  Approval,
  Channel,
  ConnectorAccess,
  CreateApprovalBody,
  CreateCaseBody,
  CreateRunBody,
  CreateStepBody,
  ResolvedCase,
  UpdateRunBody,
} from "@ph/shared";
import type { Settings } from "@ph/shared/controlroom";
import { AUTO_REFUND_LIMIT } from "./criticality.ts";
import { DemoAPIError } from "./demo-api.ts";

export type Platform = ReturnType<typeof createPlatform>;

const SETTINGS_CACHE_MS = 10_000;

export function createPlatform(baseUrl: string, fetchImpl: typeof fetch = fetch, internalKey = "", log: Pick<Console, "warn"> = console) {
  async function call<T>(method: string, path: string, body?: unknown, root = "/resolveai"): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${root}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(internalKey && { "x-resolveai-key": internalKey }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new DemoAPIError(0, `Can't reach the demo API at ${baseUrl}: ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new DemoAPIError(res.status, data?.error ?? res.statusText);
    return data as T;
  }

  let limit: { at: number; value: number } | null = null;

  /**
   * The auto-refund limit (₹) from the Control Room settings (GET /control-room/settings), cached for 10 s.
   * If the demo API can't say, the default ₹1,000 applies: the rule never switches off.
   */
  async function refundLimit(): Promise<number> {
    if (limit && Date.now() - limit.at < SETTINGS_CACHE_MS) return limit.value;
    let value = AUTO_REFUND_LIMIT;
    try {
      const s = await call<Settings>("GET", "/settings", undefined, "/control-room");
      if (typeof s.refundLimit === "number" && Number.isFinite(s.refundLimit) && s.refundLimit >= 0) value = s.refundLimit;
    } catch (e) {
      log.warn(`[agent] couldn't read the refund limit, using ${AUTO_REFUND_LIMIT}: ${(e as Error).message}`);
    }
    limit = { at: Date.now(), value };
    return value;
  }

  return {
    refundLimit,
    /** Which channel a token belongs to. 401 for unknown tokens, 403 for channels that are off. */
    authenticate: (token: string) => call<{ channel: Channel }>("POST", "/channels/authenticate", { token }).then((r) => r.channel),
    connectors: () => call<{ connectors: ConnectorAccess[] }>("GET", "/connectors/access").then((r) => r.connectors),

    createRun: (body: CreateRunBody) => call<AgentRun>("POST", "/runs", body),
    updateRun: (id: number, changes: UpdateRunBody) => call<AgentRun>("PATCH", `/runs/${id}`, changes),
    run: (id: number) => call<AgentRun>("GET", `/runs/${id}`),
    /** This chat's runs, newest first, with their steps */
    runsForSession: (sessionId: string) => call<{ runs: AgentRun[] }>("GET", `/runs?session_id=${encodeURIComponent(sessionId)}&limit=20`).then((r) => r.runs),
    runsForTicket: (ticketId: number) => call<{ runs: AgentRun[] }>("GET", `/runs?ticket_id=${ticketId}&limit=5`).then((r) => r.runs),
    addStep: (runId: number, step: CreateStepBody) => call<AgentStep>("POST", `/runs/${runId}/steps`, step),

    createApproval: (body: CreateApprovalBody) => call<Approval>("POST", "/approvals", body),
    approval: (id: number) => call<Approval>("GET", `/approvals/${id}`),
    pendingApprovalFor: (ticketId: number) =>
      call<{ approvals: Approval[] }>("GET", "/approvals?status=pending").then((r) => r.approvals.find((a) => a.ticket_id === ticketId)),
    /** A refund already waiting for approval on this order, from any ticket or chat. */
    pendingApprovalForOrder: (orderId: number) =>
      call<{ approvals: Approval[] }>("GET", "/approvals?status=pending").then((r) => r.approvals.find((a) => a.order_id === orderId)),

    searchCases: (q: string, limit = 3) => call<{ cases: ResolvedCase[] }>("GET", `/cases?q=${encodeURIComponent(q)}&limit=${limit}`).then((r) => r.cases),
    saveCase: (body: CreateCaseBody) => call<ResolvedCase>("POST", "/cases", body),
  };
}
