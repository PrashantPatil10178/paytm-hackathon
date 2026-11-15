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
import { DemoAPIError } from "./demo-api.ts";

export type Platform = ReturnType<typeof createPlatform>;

export function createPlatform(baseUrl: string, fetchImpl: typeof fetch = fetch, internalKey = "") {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/resolveai${path}`, {
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

  return {
    /** Which channel a token belongs to. 401 for unknown tokens, 403 for channels that are off. */
    authenticate: (token: string) => call<{ channel: Channel }>("POST", "/channels/authenticate", { token }).then((r) => r.channel),
    connectors: () => call<{ connectors: ConnectorAccess[] }>("GET", "/connectors/access").then((r) => r.connectors),

    createRun: (body: CreateRunBody) => call<AgentRun>("POST", "/runs", body),
    updateRun: (id: number, changes: UpdateRunBody) => call<AgentRun>("PATCH", `/runs/${id}`, changes),
    run: (id: number) => call<AgentRun>("GET", `/runs/${id}`),
    runsForTicket: (ticketId: number) => call<{ runs: AgentRun[] }>("GET", `/runs?ticket_id=${ticketId}&limit=5`).then((r) => r.runs),
    addStep: (runId: number, step: CreateStepBody) => call<AgentStep>("POST", `/runs/${runId}/steps`, step),

    createApproval: (body: CreateApprovalBody) => call<Approval>("POST", "/approvals", body),
    approval: (id: number) => call<Approval>("GET", `/approvals/${id}`),
    pendingApprovalFor: (ticketId: number) =>
      call<{ approvals: Approval[] }>("GET", "/approvals?status=pending").then((r) => r.approvals.find((a) => a.ticket_id === ticketId)),

    searchCases: (q: string, limit = 3) => call<{ cases: ResolvedCase[] }>("GET", `/cases?q=${encodeURIComponent(q)}&limit=${limit}`).then((r) => r.cases),
    saveCase: (body: CreateCaseBody) => call<ResolvedCase>("POST", "/cases", body),
  };
}
