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
import { DemoAPIError } from "./demo-api.ts";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings.ts";

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

  let cached: { at: number; value: Settings } | null = null;

  /**
   * The Control Room settings (GET /control-room/settings), over the defaults, cached for 10 s. If the demo API
   * can't say, the last copy or the defaults apply (₹1,000 auto-refund limit): the money rules never switch off.
   */
  async function settings(): Promise<Settings> {
    if (cached && Date.now() - cached.at < SETTINGS_CACHE_MS) return cached.value;
    let value = cached?.value ?? DEFAULT_SETTINGS;
    try {
      value = normalizeSettings(await call<Partial<Settings>>("GET", "/settings", undefined, "/control-room"));
    } catch (e) {
      log.warn(`[agent] couldn't read the Control Room settings, using ${cached ? "the last copy" : "the defaults"}: ${(e as Error).message}`);
    }
    cached = { at: Date.now(), value };
    return value;
  }

  /** The auto-refund limit (₹), a Control Room setting. */
  const refundLimit = async () => (await settings()).refundLimit;

  return {
    settings,
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
