/**
 * ResolveAI's own endpoints (/resolveai/*): channel and connector config, and the agents' runs,
 * steps, approvals and resolved cases. The agent writes here; the Control Room reads here.
 *
 * Channel tokens are stored as SHA-256 hashes and shown once. Connector tokens are outbound
 * credentials the agent must send, so they are stored as is but only ever returned by
 * /resolveai/connectors/access (the agent's route), never by the list the browser reads.
 */
import type {
  ConnectorId,
  CreateApprovalBody,
  CreateCaseBody,
  CreateRunBody,
  CreateStepBody,
  DecideApprovalBody,
  UpdateConnectorBody,
  UpdateRunBody,
} from "@ph/shared";
import { and, desc, eq, schema as s, sql, toApproval, toCase, toChannel, toConnector, toRun, toStep } from "@ph/db";
import { db } from "./db.ts";
import { bad, body, handle, HttpError, intParam, notFound, ok, oneOf } from "./http.ts";

const AGENT_URL = process.env.AGENT_URL?.replace(/\/$/, "");
/** Shared secret the agent sends on its own routes. Unset: those routes are open (fine on one laptop). */
const INTERNAL_KEY = process.env.RESOLVEAI_INTERNAL_KEY || "";

const RUN_STATUSES = ["triaging", "working", "waiting_approval", "escalated", "resolved", "failed"] as const;
const LEVELS = ["low", "medium", "high", "critical"] as const;
const HANDLERS = ["low", "medium", "high", "human"] as const;
const RESULTS = ["success", "blocked", "escalated"] as const;
const AGENTS = ["main", "low", "medium", "high", "human"] as const;
const OUTCOMES = ["resolved", "escalated", "rejected"] as const;

/* ───── Tokens ───── */

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const newToken = () => `rai_${Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url")}`;

async function setChannelToken(id: string, token: string) {
  const [row] = await db
    .update(s.channels)
    .set({ token_hash: sha256(token), token_hint: token.slice(-4) })
    .where(eq(s.channels.id, id))
    .returning();
  if (!row) throw notFound(`Channel ${id}`);
  return toChannel(row);
}

/**
 * The token this API sends when it forwards ShopKart chats to the agent (it plays ShopKart's backend).
 * SHOPKART_CHANNEL_TOKEN in .env wins; without it a fresh one is issued at startup and printed.
 */
let shopkartToken = "";
export const shopkartChannelToken = () => shopkartToken;

export async function prepareShopkartToken(): Promise<"env" | "issued"> {
  const fromEnv = process.env.SHOPKART_CHANNEL_TOKEN?.trim();
  if (fromEnv) {
    shopkartToken = fromEnv;
    await setChannelToken("shopkart", fromEnv);
    return "env";
  }
  shopkartToken = newToken();
  await setChannelToken("shopkart", shopkartToken);
  return "issued";
}

function requireAgent(req: Request) {
  if (INTERNAL_KEY && req.headers.get("x-resolveai-key") !== INTERNAL_KEY) throw new HttpError(401, "This route is for the ResolveAI agent");
}

/* ───── Connector health ───── */

/** A cheap read per connector that proves its base URL answers. */
const PROBE: Record<string, string> = { zendesk: "/agents", shop: "/products", hubspot: "/slots" };
const CHECK_EVERY_MS = 15_000;

async function checkConnector(id: string) {
  const [c] = await db.select().from(s.connectors).where(eq(s.connectors.id, id as ConnectorId));
  if (!c) throw notFound(`Connector ${id}`);
  let status: "connected" | "error" | "disabled" = "disabled";
  let error: string | null = null;
  if (c.enabled) {
    try {
      const res = await fetch(`${c.base_url.replace(/\/$/, "")}${PROBE[c.id] ?? ""}`, {
        headers: c.token ? { authorization: `Bearer ${c.token}` } : undefined,
        signal: AbortSignal.timeout(3000),
      });
      status = res.ok ? "connected" : "error";
      if (!res.ok) error = `HTTP ${res.status} from ${c.base_url}`;
    } catch (e) {
      status = "error";
      error = `Can't reach ${c.base_url}: ${(e as Error).message}`;
    }
  }
  const [row] = await db
    .update(s.connectors)
    .set({ status, last_error: error, last_checked_at: new Date() })
    .where(eq(s.connectors.id, c.id))
    .returning();
  return toConnector(row!);
}

async function listConnectors() {
  const rows = await db.select().from(s.connectors).orderBy(s.connectors.id);
  const stale = rows.filter((c) => !c.last_checked_at || Date.now() - c.last_checked_at.getTime() > CHECK_EVERY_MS);
  if (stale.length) await Promise.all(stale.map((c) => checkConnector(c.id)));
  return (stale.length ? await db.select().from(s.connectors).orderBy(s.connectors.id) : rows).map(toConnector);
}

/* ───── Runs ───── */

async function findRun(id: number) {
  const row = await db.query.agentRuns.findFirst({ where: eq(s.agentRuns.id, id), with: { steps: true } });
  if (!row) throw notFound(`Run ${id}`);
  return toRun(row);
}

function runChanges(b: UpdateRunBody) {
  const next: Partial<typeof s.agentRuns.$inferInsert> = { updated_at: new Date() };
  if (b.ticket_id !== undefined) next.ticket_id = b.ticket_id;
  if (b.kind !== undefined) next.kind = oneOf(b.kind, ["request", "status_check"] as const, "kind");
  if (b.intent !== undefined) next.intent = b.intent;
  if (b.level !== undefined) next.level = b.level === null ? null : oneOf(b.level, LEVELS, "level");
  if (b.level_reason !== undefined) next.level_reason = b.level_reason;
  if (b.handled_by !== undefined) next.handled_by = b.handled_by === null ? null : oneOf(b.handled_by, HANDLERS, "handled_by");
  if (b.status !== undefined) next.status = oneOf(b.status, RUN_STATUSES, "status");
  if (b.plan !== undefined) next.plan = b.plan;
  if (b.reply !== undefined) next.reply = b.reply;
  return next;
}

/* ───── Approvals ───── */

async function notifyAgent(approvalId: number) {
  if (!AGENT_URL) return "no agent configured (set AGENT_URL); the decision is recorded only";
  try {
    const res = await fetch(`${AGENT_URL}/approvals/${approvalId}/decided`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(INTERNAL_KEY && { "x-resolveai-key": INTERNAL_KEY }) },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return `agent answered HTTP ${res.status}`;
    return null;
  } catch (e) {
    return `agent unreachable: ${(e as Error).message}`;
  }
}

/* ───── Routes ───── */

export const resolveaiRoutes = {
  /* Channels */
  "/resolveai/channels": {
    GET: handle(async () => ok({ channels: (await db.select().from(s.channels).orderBy(s.channels.created_at)).map(toChannel) })),
  },
  "/resolveai/channels/:id": {
    PATCH: handle(async (req) => {
      const b = await body<{ enabled?: boolean; name?: string }>(req);
      const next: Partial<typeof s.channels.$inferInsert> = {};
      if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
      if (b.name?.trim()) next.name = b.name.trim();
      const [row] = await db.update(s.channels).set(next).where(eq(s.channels.id, String(req.params.id))).returning();
      if (!row) throw notFound(`Channel ${req.params.id}`);
      return ok(toChannel(row));
    }),
  },
  "/resolveai/channels/:id/token": {
    /** Issues a new token (the old one stops working). The token is in this response only. */
    POST: handle(async (req) => {
      const token = newToken();
      const channel = await setChannelToken(String(req.params.id), token);
      if (channel.id === "shopkart") shopkartToken = token;
      return ok({ channel, token }, 201);
    }),
  },
  "/resolveai/channels/authenticate": {
    /** The agent asks: which channel does this token belong to? */
    POST: handle(async (req) => {
      requireAgent(req);
      const { token } = await body<{ token?: string }>(req);
      if (!token) throw bad("token is required");
      const [row] = await db.select().from(s.channels).where(eq(s.channels.token_hash, sha256(token)));
      if (!row) throw new HttpError(401, "Unknown channel token");
      if (!row.enabled) throw new HttpError(403, `Channel ${row.name} is turned off`);
      const [used] = await db.update(s.channels).set({ last_used_at: new Date() }).where(eq(s.channels.id, row.id)).returning();
      return ok({ channel: toChannel(used!) });
    }),
  },

  /* Connectors */
  "/resolveai/connectors": {
    GET: handle(async () => ok({ connectors: await listConnectors() })),
  },
  "/resolveai/connectors/access": {
    /** Base URLs and tokens, for the agent only. */
    GET: handle(async (req) => {
      requireAgent(req);
      const rows = await db.select().from(s.connectors);
      return ok({ connectors: rows.map(({ id, base_url, token, enabled }) => ({ id, base_url, token, enabled })) });
    }),
  },
  "/resolveai/connectors/:id": {
    PATCH: handle(async (req) => {
      const b = await body<UpdateConnectorBody>(req);
      const next: Partial<typeof s.connectors.$inferInsert> = {};
      if (b.base_url !== undefined) {
        try {
          next.base_url = new URL(b.base_url).toString().replace(/\/$/, "");
        } catch {
          throw bad("base_url must be a full URL, e.g. http://localhost:4000/zendesk");
        }
      }
      if (b.token !== undefined) next.token = b.token?.trim() || null;
      if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
      const [row] = await db.update(s.connectors).set(next).where(eq(s.connectors.id, String(req.params.id) as ConnectorId)).returning();
      if (!row) throw notFound(`Connector ${req.params.id}`);
      return ok(await checkConnector(row.id));
    }),
  },
  "/resolveai/connectors/:id/check": {
    POST: handle(async (req) => ok(await checkConnector(String(req.params.id)))),
  },

  /* Runs */
  "/resolveai/runs": {
    GET: handle(async (req) => {
      const q = new URL(req.url).searchParams;
      const limit = Math.min(Number(q.get("limit")) || 50, 200);
      const session = q.get("session_id");
      const ticket = q.get("ticket_id");
      const where = session ? eq(s.agentRuns.session_id, session) : ticket ? eq(s.agentRuns.ticket_id, intParam(ticket, "ticket_id")) : undefined;
      const rows = await db.query.agentRuns.findMany({ where, with: { steps: true }, orderBy: desc(s.agentRuns.id), limit });
      return ok({ runs: rows.map(toRun) });
    }),
    POST: handle(async (req) => {
      const b = await body<CreateRunBody>(req);
      if (!b.channel_id || !b.session_id || !b.customer_id || !b.message?.trim()) throw bad("channel_id, session_id, customer_id and message are required");
      const [row] = await db
        .insert(s.agentRuns)
        .values({ channel_id: b.channel_id, session_id: b.session_id, customer_id: b.customer_id, message: b.message.trim(), kind: b.kind ?? "request" })
        .returning();
      return ok(toRun({ ...row!, steps: [] }), 201);
    }),
  },
  "/resolveai/runs/:id": {
    GET: handle(async (req) => ok(await findRun(intParam(req.params.id, "Run id")))),
    PATCH: handle(async (req) => {
      const id = intParam(req.params.id, "Run id");
      const [row] = await db.update(s.agentRuns).set(runChanges(await body<UpdateRunBody>(req))).where(eq(s.agentRuns.id, id)).returning();
      if (!row) throw notFound(`Run ${id}`);
      return ok(await findRun(id));
    }),
  },
  "/resolveai/runs/:id/steps": {
    POST: handle(async (req) => {
      const run_id = intParam(req.params.id, "Run id");
      const b = await body<CreateStepBody>(req);
      if (!b.step?.trim() || !b.tool?.trim()) throw bad("step and tool are required");
      const [row] = await db
        .insert(s.agentSteps)
        .values({ run_id, agent: oneOf(b.agent, AGENTS, "agent"), step: b.step.trim(), tool: b.tool.trim(), result: oneOf(b.result, RESULTS, "result"), detail: b.detail ?? "" })
        .returning();
      await db.update(s.agentRuns).set({ updated_at: new Date() }).where(eq(s.agentRuns.id, run_id));
      return ok(toStep(row!), 201);
    }),
  },

  /* Approvals */
  "/resolveai/approvals": {
    GET: handle(async (req) => {
      const status = new URL(req.url).searchParams.get("status");
      const where = status ? eq(s.approvals.status, oneOf(status, ["pending", "approved", "rejected"] as const, "status")) : undefined;
      const rows = await db.select().from(s.approvals).where(where).orderBy(desc(s.approvals.id)).limit(100);
      return ok({ approvals: rows.map(toApproval) });
    }),
    POST: handle(async (req) => {
      const b = await body<CreateApprovalBody>(req);
      if (!b.run_id || !b.ticket_id || !b.order_id || !(b.amount > 0)) throw bad("run_id, ticket_id, order_id and a positive amount are required");
      const [row] = await db
        .insert(s.approvals)
        .values({ run_id: b.run_id, ticket_id: b.ticket_id, action: "refund", order_id: b.order_id, amount: b.amount, reason: b.reason ?? "", summary: b.summary ?? "", suggestion: b.suggestion ?? "" })
        .returning();
      return ok(toApproval(row!), 201);
    }),
  },
  "/resolveai/approvals/:id": {
    GET: handle(async (req) => {
      const [row] = await db.select().from(s.approvals).where(eq(s.approvals.id, intParam(req.params.id, "Approval id")));
      if (!row) throw notFound("Approval");
      return ok(toApproval(row));
    }),
  },
  "/resolveai/approvals/:id/decide": {
    /** A person decides. The agent is then told, and carries out (or drops) the action. */
    POST: handle(async (req) => {
      const id = intParam(req.params.id, "Approval id");
      const b = await body<DecideApprovalBody>(req);
      const decision = oneOf(b.decision, ["approved", "rejected"] as const, "decision");
      const [row] = await db
        .update(s.approvals)
        .set({ status: decision, decided_by: b.decided_by?.trim() || "Support lead", note: b.note?.trim() || null, decided_at: new Date() })
        .where(and(eq(s.approvals.id, id), eq(s.approvals.status, "pending")))
        .returning();
      if (!row) throw bad(`Approval ${id} doesn't exist or was already decided`);
      const warning = await notifyAgent(id);
      return ok({ approval: toApproval(row), ...(warning && { warning }) });
    }),
  },

  /* Resolved cases (the main agent's memory) */
  "/resolveai/cases": {
    GET: handle(async (req) => {
      const q = new URL(req.url).searchParams;
      const text = q.get("q")?.trim();
      const intent = q.get("intent")?.trim();
      const limit = Math.min(Number(q.get("limit")) || 5, 50);
      const doc = sql`to_tsvector('english', ${s.resolvedCases.problem} || ' ' || ${s.resolvedCases.resolution} || ' ' || array_to_string(${s.resolvedCases.tags}, ' '))`;
      // Any of the words matches; more matching words rank higher.
      const words = text ? [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 12) : [];
      const tsq = words.length ? sql`to_tsquery('english', ${words.join(" | ")})` : null;
      const match = tsq ? sql`${doc} @@ ${tsq}` : undefined;
      const rows = await db
        .select()
        .from(s.resolvedCases)
        .where(and(match, intent ? eq(s.resolvedCases.intent, intent) : undefined))
        .orderBy(tsq ? sql`ts_rank(${doc}, ${tsq}) desc` : desc(s.resolvedCases.id))
        .limit(limit);
      return ok({ cases: rows.map(toCase) });
    }),
    POST: handle(async (req) => {
      const b = await body<CreateCaseBody>(req);
      if (!b.problem?.trim() || !b.resolution?.trim() || !b.intent?.trim()) throw bad("intent, problem and resolution are required");
      const [row] = await db
        .insert(s.resolvedCases)
        .values({
          run_id: b.run_id,
          ticket_id: b.ticket_id ?? null,
          customer_id: b.customer_id,
          intent: b.intent.trim(),
          level: oneOf(b.level, LEVELS, "level"),
          handled_by: oneOf(b.handled_by, HANDLERS, "handled_by"),
          problem: b.problem.trim(),
          steps: b.steps ?? [],
          resolution: b.resolution.trim(),
          outcome: oneOf(b.outcome, OUTCOMES, "outcome"),
          tags: b.tags ?? [],
        })
        .returning();
      return ok(toCase(row!), 201);
    }),
  },
};

