/**
 * Runs the real agents and service against an in-memory fake of the demo API (Zendesk, shop, CRM and
 * ResolveAI's /resolveai records) and a scripted model, so no other services or API keys are needed.
 *
 * One scripted model plays every agent in turn: the main agent's triage (a JSON text), then the level
 * agent's tool calls and reply.
 */
import { beforeEach, expect, test } from "bun:test";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createLevelAgents } from "../src/agents/levels.ts";
import { createMainAgent, createWriterAgent, type Triage } from "../src/agents/main.ts";
import { createAnalysisAgent } from "../src/agents/analysis.ts";
import { createLeadsAgent } from "../src/agents/leads.ts";
import { createSalesAgent } from "../src/agents/sales.ts";
import { assessCriticality } from "../src/criticality.ts";
import { createDemoAPI } from "../src/demo-api.ts";
import { createPlatform } from "../src/platform.ts";
import { analysisNote, analysisThread, createAgentMemory } from "../src/memory.ts";
import { indianRupees } from "../src/tools/analysis.ts";
import { createService } from "../src/service.ts";

/* ───── Fake demo API ───── */

type Json = Record<string, any>;
let db: {
  tickets: Json[];
  comments: Json[];
  orders: Json[];
  contacts: Json[];
  deals: Json[];
  notes: Json[];
  meetings: Json[];
  channels: Json[];
  connectors: Json[];
  runs: Json[];
  steps: Json[];
  approvals: Json[];
  cases: Json[];
};

const TOKEN = "rai_test_token";
let db: { tickets: Json[]; comments: Json[]; orders: Json[]; contacts: Json[]; deals: Json[]; notes: Json[]; meetings: Json[]; responses: Json[]; reports: Json[] };

const response = (id: number, x: Json) => ({
  id, campaign: { id: 1, name: "Diwali bulk gifting", channel: "meta_ads" }, phone: "", need: "bulk_order", start_when: "", budget: null,
  status: "new", contact_id: null, deal_id: null, note: "", created_at: "2026-11-15T05:00:00.000Z", processed_at: null, ...x,
});

beforeEach(() => {
  db = {
    tickets: [],
    comments: [],
    orders: [
      { id: 1023, customer_id: 101, status: "delivered", payment_status: "paid", amount: 500, items: [{ name: "Mug", qty: 2 }], placed_at: "2026-11-10", updated_at: "2026-11-13" },
      { id: 1030, customer_id: 101, status: "delivered", payment_status: "paid", amount: 4200, items: [{ name: "Lamp", qty: 1 }], placed_at: "2026-11-09", updated_at: "2026-11-12" },
      { id: 1040, customer_id: 102, status: "delivered", payment_status: "paid", amount: 300, items: [{ name: "Tea", qty: 1 }], placed_at: "2026-11-09", updated_at: "2026-11-12" },
      { id: 1050, customer_id: 101, status: "shipped", payment_status: "paid", amount: 900, items: [{ name: "Kettle", qty: 1 }], placed_at: "2026-11-13", updated_at: "2026-11-14" },
      { id: 1060, customer_id: 101, status: "placed", payment_status: "failed_debited", amount: 15000, items: [{ name: "Phone", qty: 1 }], placed_at: "2026-11-14", updated_at: "2026-11-14" },
    ],
    contacts: [],
    deals: [],
    notes: [],
    meetings: [],
    channels: [{ id: "shopkart", name: "ShopKart chat", kind: "chat", enabled: true, token: TOKEN }],
    connectors: ["zendesk", "shop", "hubspot"].map((id) => ({ id, base_url: `http://demo/${id === "hubspot" ? "crm" : id}`, token: null, enabled: true })),
    runs: [],
    steps: [],
    approvals: [],
    cases: [],
    responses: [
      response(1, { name: "Meera Joshi", email: "meera@joshisweets.example", company: "Joshi Sweets", budget: 90000, start_when: "This week", message: "Need 500 Diwali hampers with our logo." }),
      response(2, { name: "Promo Blast", email: "noreply@promo.example", company: "", need: "other", message: "WIN a FREE iPhone!!! bit.ly/xx" }),
      response(3, { name: "Rakesh Sharma", email: "rakesh@sharmarestaurants.example", company: "Sharma Restaurants", need: "billing_setup", budget: 50000, message: "Still interested in billing." }),
    ],
    reports: [],
  };
});

const METRICS = {
  generated_at: "2026-11-15T10:00:00.000Z",
  totals: { tickets: 10, tickets_ai: 6, ai_rate: 60, campaign_spend: 83350, campaign_leads: 0 },
  datasets: [{ id: "tickets_per_day", title: "Tickets per day", description: "x", series: [{ key: "ai", label: "AI", unit: "count" }], rows: [{ key: "2026-11-15", label: "15 Nov", ai: 6 }] }],
};

const json = (data: unknown, status = 200) => Response.json(data, { status });
const ticketView = (t: Json) => ({ ...t, comments: db.comments.filter((c) => c.ticket_id === t.id) });
const runView = (r: Json) => ({ ...r, steps: db.steps.filter((s) => s.run_id === r.id) });

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const p = url.pathname;
  let m: RegExpMatchArray | null;

  /* Zendesk */
  if (method === "POST" && p === "/zendesk/tickets") {
    const t = { id: 2041 + db.tickets.length, requester: { id: body.requester_id, name: "Ananya Iyer" }, escalated_by_ai: false, level: null, handled_by: null, created_at: new Date().toISOString(), ...body };
    db.tickets.push(t);
    return json(ticketView(t), 201);
  }
  if ((m = p.match(/^\/zendesk\/tickets\/(\d+)$/))) {
    const t = db.tickets.find((x) => x.id === Number(m![1]));
    if (!t) return json({ error: "Ticket not found" }, 404);
    if (method === "PATCH") {
      if (body.assignee && t.assignee === "ResolveAI Bot" && body.assignee !== "ResolveAI Bot") t.escalated_by_ai = true;
      Object.assign(t, body);
    }
    return json(ticketView(t));
  }
  if ((m = p.match(/^\/zendesk\/tickets\/(\d+)\/comments$/))) {
    db.comments.push({ ticket_id: Number(m[1]), ...body });
    return json({ id: db.comments.length }, 201);
  }
  if ((m = p.match(/^\/zendesk\/users\/(\d+)\/tickets$/))) {
    return json({ tickets: db.tickets.filter((t) => t.requester.id === Number(m![1])).sort((a, b) => b.id - a.id) });
  }

  /* Shop */
  if ((m = p.match(/^\/shop\/customers\/(\d+)\/orders$/))) {
    return json({ customer: { id: Number(m[1]), name: "Ananya Iyer" }, orders: db.orders.filter((o) => o.customer_id === Number(m![1])) });
  }
  if ((m = p.match(/^\/shop\/orders\/(\d+)(\/refund)?$/))) {
    const o = db.orders.find((x) => x.id === Number(m![1]));
    if (!o) return json({ error: "Order not found" }, 404);
    if (m[2]) Object.assign(o, { status: "damaged", payment_status: "refund_initiated" });
    return json(o);
  }

  /* CRM */
  if (method === "POST" && p === "/crm/contacts") {
    const c = { id: 9 + db.contacts.length, ...body };
    db.contacts.push(c);
    return json(c, 201);
  }
  if (method === "POST" && p === "/crm/deals") {
    const d = { id: 9 + db.deals.length, stage: "new_lead", score: "warm", ...body };
    db.deals.push(d);
    return json(d, 201);
  }
  if ((m = p.match(/^\/crm\/deals\/(\d+)$/)) && method === "PATCH") {
    const d = db.deals.find((x) => x.id === Number(m![1]))!;
    Object.assign(d, body);
    return json(d);
  }
  if ((m = p.match(/^\/crm\/deals\/(\d+)\/notes$/))) {
    db.notes.push({ deal_id: Number(m[1]), ...body });
    return json({ id: db.notes.length }, 201);
  }
  if (p === "/crm/slots") return json({ slots: [{ start: "2026-11-17T05:30:00.000Z", end: "2026-11-17T06:00:00.000Z" }] });
  if (method === "POST" && p === "/crm/meetings") {
    const mt = { id: 1, title: "Intro call", attendees: ["Meera Shah", "Rahul – Sales"], ...body };
    db.meetings.push(mt);
    return json(mt, 201);
  }

  /* ResolveAI records */
  if (p === "/resolveai/channels/authenticate") {
    const c = db.channels.find((x) => x.token === body.token);
    if (!c) return json({ error: "Unknown channel token" }, 401);
    if (!c.enabled) return json({ error: `Channel ${c.name} is turned off` }, 403);
    return json({ channel: c });
  }
  if (p === "/resolveai/connectors/access") return json({ connectors: db.connectors });
  if (p === "/resolveai/runs" && method === "POST") {
    const r = { id: db.runs.length + 1, kind: "request", status: "triaging", plan: [], ticket_id: null, level: null, handled_by: null, intent: null, reply: null, ...body };
    db.runs.push(r);
    return json(runView(r), 201);
  }
  if (p === "/resolveai/runs" && method === "GET") {
    const tid = Number(url.searchParams.get("ticket_id"));
    return json({ runs: db.runs.filter((r) => r.ticket_id === tid).sort((a, b) => b.id - a.id).map(runView) });
  }
  if ((m = p.match(/^\/resolveai\/runs\/(\d+)$/))) {
    const r = db.runs.find((x) => x.id === Number(m![1]));
    if (!r) return json({ error: "Run not found" }, 404);
    if (method === "PATCH") Object.assign(r, body);
    return json(runView(r));
  }
  if ((m = p.match(/^\/resolveai\/runs\/(\d+)\/steps$/))) {
    const s = { id: db.steps.length + 1, run_id: Number(m[1]), ...body };
    db.steps.push(s);
    return json(s, 201);
  }
  if (p === "/resolveai/approvals" && method === "POST") {
    const a = { id: db.approvals.length + 1, status: "pending", decided_by: null, note: null, ...body };
    db.approvals.push(a);
    return json(a, 201);
  }
  if (p === "/resolveai/approvals" && method === "GET") {
    const status = url.searchParams.get("status");
    return json({ approvals: db.approvals.filter((a) => !status || a.status === status) });
  }
  if ((m = p.match(/^\/resolveai\/approvals\/(\d+)$/))) return json(db.approvals.find((a) => a.id === Number(m![1])));
  if (p === "/resolveai/cases" && method === "POST") {
    const c = { id: db.cases.length + 1, ...body };
    db.cases.push(c);
    return json(c, 201);
  }
  if (p === "/resolveai/cases") return json({ cases: db.cases.slice(-3) });

  if (p === "/campaigns/responses" && url.searchParams.get("status") === "new") return json({ responses: db.responses.filter((r) => r.status === "new") });
  if ((m = p.match(/^\/campaigns\/responses\/(\d+)(\/convert|\/skip)?$/))) {
    const r = db.responses.find((x) => x.id === Number(m![1]));
    if (!r) return json({ error: "Campaign response not found" }, 404);
    if (!m[2]) {
      const known = r.email === "rakesh@sharmarestaurants.example" ? { id: 1, company: "Sharma Restaurants", deals: [{ id: 1, name: "Sharma Restaurants – Billing setup", stage: "meeting_booked", amount: 50000 }] } : null;
      return json({ ...r, existing_contact: known });
    }
    if (r.status !== "new") return json({ error: `Campaign response ${r.id} was already ${r.status}` }, 409);
    if (m[2] === "/skip") return json(Object.assign(r, { status: "skipped", note: body.reason }));
    const deal = { id: 9 + db.deals.length, name: body.deal_name, amount: body.amount, score: body.score, next_step: body.next_step, stage: "new_lead" };
    db.deals.push(deal);
    Object.assign(r, { status: "converted", deal_id: deal.id, note: body.note });
    return json({ response: r, contact: { id: 20 + db.deals.length }, deal, existing_contact: false }, 201);
  }
  if (p === "/analytics/metrics") return json(METRICS);
  if (p === "/analytics/reports" && method === "GET") return json({ reports: db.reports });
  if (p === "/analytics/reports" && method === "POST") {
    const r = { id: 1 + db.reports.length, author: "ResolveAI Bot", snapshot: METRICS.totals, created_at: new Date().toISOString(), ...body };
    db.reports.push(r);
    return json(r, 201);
  }
  return json({ error: `${method} ${p} not found` }, 404);
}) as typeof fetch;

/* ───── Scripted model ───── */

type Step = { tool: string; args?: Json } | { text: string };
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** A model that plays the given steps in order: tool calls and texts, across every agent that uses it. */
function scripted(steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = steps[i++];
      if (!step) throw new Error("script ran out of steps");
      if ("text" in step) return { content: [{ type: "text", text: step.text }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
      return {
        content: [{ type: "tool-call", toolCallId: `call-${i}`, toolName: step.tool, input: JSON.stringify(step.args ?? {}) }],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

/** The main agent's triage, as the JSON text the model returns. */
function triage(t: Partial<Triage> & Pick<Triage, "intent">): Step {
  const full: Triage = {
    kind: "new_request",
    order_id: null,
    summary: "Customer needs help with an order",
    signals: { angry: false, urgent: false, legal_or_fraud: false, wants_human: false },
    confidence: 0.9,
    plan: ["Check the order", "Resolve and reply"],
    ...t,
  };
  return { text: JSON.stringify(full) };
}

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [] });

/**
 * A model that answers from the prompt it is given, for agents run in parallel (where a fixed script
 * would interleave). Calls `decide` with the latest user message; once a tool has run, it finishes.
 */
function byPrompt(decide: (prompt: string) => Step) {
  let n = 0;
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const msgs = prompt as Json[];
      if (msgs.at(-1)!.role === "tool") return textResult("Done.");
      const user = [...msgs].reverse().find((x) => x.role === "user")!;
      const text = typeof user.content === "string" ? user.content : user.content.map((c: Json) => c.text ?? "").join("");
      const step = decide(text);
      if ("text" in step) return textResult(step.text);
      return {
        content: [{ type: "tool-call" as const, toolCallId: `call-p${++n}`, toolName: step.tool, input: JSON.stringify(step.args ?? {}) }],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
}

const failing = () =>
  new MockLanguageModelV3({
    doGenerate: async () => {
      // What a provider throws for a bad key: not retryable.
      throw new APICallError({ message: "401 invalid x-api-key", url: "https://model", requestBodyValues: {}, statusCode: 401, isRetryable: false });
    },
  });

function service(model: MockLanguageModelV3, baseUrl = "http://demo", fetchImpl: typeof fetch = fakeFetch) {
  const platform = createPlatform(baseUrl, fetchImpl);
  const api = createDemoAPI(baseUrl, fetchImpl, () => platform.connectors());
  const quiet = { warn() {}, error() {} };
  return createService({ api, platform, main: createMainAgent(model), writer: createWriterAgent(model), levels: createLevelAgents(api, model, platform), sales: createSalesAgent(api, model), analysis: createAnalysisAgent(api, model), leads: createLeadsAgent(api, model), log: quiet });
}

/** Sends a chat, then waits for the level agent working in the background, like the customer would. */
async function chat(svc: ReturnType<typeof service>, session: string, message: string, customer = 101) {
  const res = await svc.intake(TOKEN, { session_id: session, customer_id: customer, message });
  await svc.settled();
  return res;
}
const ACK = "Thanks, Ananya. I'm on it: this is ticket #2041, and I'll get back to you here in a few minutes.";

/* ───── Criticality rules ───── */

const calm = { angry: false, urgent: false, legal_or_fraud: false, wants_human: false };

test("criticality: hard rules for money and risk, signals push it up", () => {
  const paid = { status: "delivered", payment_status: "paid" } as const;
  expect(assessCriticality({ intent: "order_tracking", signals: calm, confidence: 0.9, recentTickets: 0 }).level).toBe("low");
  expect(assessCriticality({ intent: "damaged_item", signals: calm, confidence: 0.9, order: { ...paid, amount: 500 }, recentTickets: 0 }).level).toBe("medium");
  expect(assessCriticality({ intent: "damaged_item", signals: calm, confidence: 0.9, order: { ...paid, amount: 4200 }, recentTickets: 0 }).level).toBe("high");
  expect(assessCriticality({ intent: "question", signals: calm, confidence: 0.9, order: { status: "placed", payment_status: "failed_debited", amount: 15000 }, recentTickets: 0 })).toMatchObject({ level: "critical", handled_by: "human" });
  expect(assessCriticality({ intent: "refund", signals: { ...calm, legal_or_fraud: true }, confidence: 0.9, recentTickets: 0 }).level).toBe("critical");
  expect(assessCriticality({ intent: "order_tracking", signals: calm, confidence: 0.4, recentTickets: 0 }).level).toBe("medium");
  expect(assessCriticality({ intent: "order_tracking", signals: { ...calm, angry: true }, confidence: 0.9, recentTickets: 2 }).level).toBe("medium");
  expect(assessCriticality({ intent: "order_tracking", signals: { ...calm, wants_human: true }, confidence: 0.9, recentTickets: 0 }).level).toBe("high");
});

/* ───── Channel token ───── */

test("intake: needs a valid token from an enabled channel", async () => {
  const svc = service(scripted([]));
  const body = { session_id: "t", customer_id: 101, message: "hi" };
  expect((await svc.intake(undefined, body)).status).toBe(401);
  expect((await svc.intake("rai_wrong", body)).status).toBe(401);
  db.channels[0]!.enabled = false;
  expect((await svc.intake(TOKEN, body)).status).toBe(403);
  expect(db.runs).toHaveLength(0);
});

/* ───── Routing by level ───── */

test("low: the low agent answers a tracking question and closes the ticket; the case is saved", async () => {
  const svc = service(
    scripted([
      triage({ intent: "order_tracking", order_id: 1050, summary: "Asks where the kettle order is" }),
      { tool: "get_order", args: { order_id: 1050 } },
      { tool: "update_ticket", args: { status: "solved", tags: ["wismo"] } },
      { text: "Your kettle has shipped and arrives in 1–2 days." },
    ]),
  );
  const res = await chat(svc, "s-low", "Where is my kettle?");

  expect(res).toEqual({ status: 200, body: { reply: ACK, ticket_id: 2041 } });
  expect(db.comments.filter((c) => c.public && !c.author).map((c) => c.body)).toEqual([ACK, "Your kettle has shipped and arrives in 1–2 days."]);
  expect(db.tickets[0]).toMatchObject({ status: "solved", level: "low", handled_by: "low", priority: "low", subject: "Where is my order – order #1050" });
  expect(db.runs[0]).toMatchObject({ level: "low", handled_by: "low", status: "resolved", ticket_id: 2041 });
  expect(db.steps.map((s) => `${s.agent}:${s.step}`)).toEqual(["main:Receive request", "main:Triage", "main:Set level", "main:Acknowledge", "main:Open ticket", "low:Check order", "low:Close ticket", "main:Save to memory"]);
  expect(db.cases[0]).toMatchObject({ intent: "order_tracking", level: "low", handled_by: "low", outcome: "resolved", problem: "Asks where the kettle order is" });
});

test("medium: the medium agent refunds a small damaged order", async () => {
  const svc = service(
    scripted([
      triage({ intent: "damaged_item", order_id: 1023, summary: "Mugs arrived broken" }),
      { tool: "start_refund", args: { order_id: 1023, reason: "mugs arrived broken" } },
      { tool: "update_ticket", args: { status: "solved" } },
      { text: "Sorry about the mugs! I've started a refund of ₹500." },
    ]),
  );
  await chat(svc, "s-med", "My mugs arrived broken");

  expect(db.orders[0]!.payment_status).toBe("refund_initiated");
  expect(db.tickets[0]).toMatchObject({ status: "solved", level: "medium", handled_by: "medium" });
  expect(db.comments.filter((c) => !c.public).map((c) => c.body).join("\n")).toContain("ResolveAI triage: Medium → medium agent");
  expect(db.cases[0]).toMatchObject({ level: "medium", outcome: "resolved" });
});

test("medium: the refund tool still refuses above the limit, whatever the model asks", async () => {
  const svc = service(
    scripted([
      triage({ intent: "damaged_item", order_id: null }),
      { tool: "start_refund", args: { order_id: 1030, reason: "lamp broken" } },
      { tool: "escalate_to_human", args: { assignee: "Priya – Support", priority: "high", note: "Lamp refund of ₹4,200 needs approval." } },
      { text: "A teammate will look at your refund." },
    ]),
  );
  await chat(svc, "s-lim", "Something arrived broken");

  expect(db.orders[1]!.payment_status).toBe("paid");
  expect(db.tickets[0]).toMatchObject({ assignee: "Priya – Support", escalated_by_ai: true, handled_by: "human" });
  expect(db.runs[0]).toMatchObject({ status: "escalated", handled_by: "human" });
  expect(db.steps.find((s) => s.step === "Refund")).toMatchObject({ result: "blocked" });
});

test("tools can't touch another customer's order", async () => {
  const svc = service(scripted([triage({ intent: "refund" }), { tool: "start_refund", args: { order_id: 1040, reason: "x" } }, { text: "ok" }]));
  await chat(svc, "s-other", "refund order 1040");
  expect(db.orders[2]!.payment_status).toBe("paid");
});

test("high: the high agent asks for approval; once approved the refund runs, the customer is told and the case is saved", async () => {
  const svc = service(
    scripted([
      triage({ intent: "damaged_item", order_id: 1030, summary: "Lamp arrived broken" }),
      { tool: "get_order", args: { order_id: 1030 } },
      { tool: "request_approval", args: { order_id: 1030, reason: "lamp broken", summary: "Delivered lamp arrived broken; ₹4,200 paid.", suggestion: "Refund ₹4,200 to the original payment method" } },
      { text: "Your refund is with a teammate for a quick approval (ticket #2041)." },
    ]),
  );
  await chat(svc, "s-high", "The lamp arrived broken, refund please");

  expect(db.orders[1]!.payment_status).toBe("paid");
  expect(db.approvals[0]).toMatchObject({ status: "pending", amount: 4200, order_id: 1030, ticket_id: 2041, run_id: 1 });
  expect(db.tickets[0]).toMatchObject({ status: "pending", level: "high", handled_by: "high" });
  expect(db.runs[0]).toMatchObject({ status: "waiting_approval" });
  expect(db.cases).toHaveLength(0);

  // A person approves in the Control Room; the demo API records it and tells the agent.
  Object.assign(db.approvals[0]!, { status: "approved", decided_by: "Riya" });
  const res = await svc.approvalDecided(1);

  expect(res.status).toBe(200);
  expect(db.orders[1]!.payment_status).toBe("refund_initiated");
  expect(db.tickets[0]!.status).toBe("solved");
  expect(db.runs[0]).toMatchObject({ status: "resolved" });
  expect(db.comments.at(-1)).toMatchObject({ public: true, body: expect.stringContaining("refund of ₹4,200 for order #1030 is approved") });
  expect(db.cases[0]).toMatchObject({ level: "high", handled_by: "high", outcome: "resolved" });
});

test("high: a rejected approval goes to a person and is remembered as rejected", async () => {
  const svc = service(
    scripted([
      triage({ intent: "refund", order_id: 1030 }),
      { tool: "request_approval", args: { order_id: 1030, reason: "changed mind", summary: "Wants a refund on a delivered lamp.", suggestion: "Refund ₹4,200" } },
      { text: "A teammate will confirm shortly." },
    ]),
  );
  await chat(svc, "s-rej", "I want my money back for the lamp");
  Object.assign(db.approvals[0]!, { status: "rejected", decided_by: "Riya", note: "Outside the return window" });
  await svc.approvalDecided(1);

  expect(db.orders[1]!.payment_status).toBe("paid");
  expect(db.tickets[0]).toMatchObject({ assignee: "Priya – Support", handled_by: "human" });
  expect(db.cases[0]).toMatchObject({ outcome: "rejected" });
});

test("critical: a failed payment goes straight to a person with a brief; no level agent runs", async () => {
  const svc = service(scripted([triage({ intent: "payment_failed", order_id: 1060, summary: "₹15,000 debited but the order failed" })]));
  const res = await chat(svc, "s-crit", "₹15,000 debited but payment failed!");

  expect(res.body).toMatchObject({ reply: expect.stringContaining("payments team"), ticket_id: 2041 });
  expect(db.tickets[0]).toMatchObject({ assignee: "Priya – Support", priority: "urgent", level: "critical", handled_by: "human" });
  expect(db.comments.find((c) => !c.public && c.body.startsWith("Critical"))!.body).toContain("Order #1060");
  expect(db.runs[0]).toMatchObject({ status: "escalated", level: "critical" });
  expect(db.cases[0]).toMatchObject({ level: "critical", outcome: "escalated" });
});

test("the main agent answers at once while the level agent works in the background", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const steps: Parameters<typeof scripted>[0] = [
    triage({ intent: "damaged_item", order_id: 1023 }),
    { tool: "start_refund", args: { order_id: 1023, reason: "broken" } },
    { tool: "update_ticket", args: { status: "solved" } },
    { text: "Refund of ₹500 started." },
  ];
  let i = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (opts) => {
      if (i === 1) await gate; // hold the level agent's first call until we've checked the reply
      return scripted(steps.slice(i++, i)).doGenerate(opts);
    },
  });
  const svc = service(model);
  const res = await svc.intake(TOKEN, { session_id: "s-bg", customer_id: 101, message: "Mugs broken" });

  expect(res.body).toEqual({ reply: ACK, ticket_id: 2041 });
  expect(db.orders[0]!.payment_status).toBe("paid"); // not yet: the medium agent is still working
  release();
  await svc.settled();
  expect(db.orders[0]!.payment_status).toBe("refund_initiated");
  expect(db.comments.at(-1)).toMatchObject({ public: true, body: "Refund of ₹500 started." });
  expect(db.runs[0]).toMatchObject({ status: "resolved", reply: "Refund of ₹500 started." });
});

/* ───── Status checks and follow-ups ───── */

test("status check: answers from the ticket and pending approval, without opening a new ticket", async () => {
  const svc = service(
    scripted([
      triage({ intent: "damaged_item", order_id: 1030 }),
      { tool: "request_approval", args: { order_id: 1030, reason: "lamp broken", summary: "Lamp arrived broken.", suggestion: "Refund ₹4,200" } },
      { text: "It's with a teammate for approval." },
      triage({ kind: "status_check", intent: "refund", order_id: 1030 }),
      { text: "Your ₹4,200 refund is waiting for a quick approval (ticket #2041)." },
    ]),
  );
  await chat(svc, "s-status", "Lamp broken, refund please");
  const res = await chat(svc, "s-status", "Any update on my refund?");

  expect(res.body).toEqual({ reply: "Your ₹4,200 refund is waiting for a quick approval (ticket #2041).", ticket_id: 2041 });
  expect(db.tickets).toHaveLength(1);
  expect(db.runs[1]).toMatchObject({ kind: "status_check", status: "resolved", ticket_id: 2041 });
  expect(db.steps.at(-1)).toMatchObject({ step: "Status update", detail: expect.stringContaining("waiting for approval") });
});

test("status check: a JSON answer from the model never reaches the customer", async () => {
  db.tickets.push({ id: 2041, requester: { id: 101, name: "Ananya Iyer" }, subject: "Refund", status: "open", assignee: "ResolveAI Bot", tags: [], level: "high", handled_by: "high", created_at: new Date().toISOString() });
  const svc = service(scripted([triage({ kind: "status_check", intent: "refund" }), { text: '{"kind":"status_check"}' }]));
  const res = await chat(svc, "s-json", "any update?");
  expect((res.body as { reply: string }).reply).toBe("Your request (ticket #2041) is being handled by ResolveAI. You'll get an update here as soon as there's progress.");
});

test("status check from a new chat finds the customer's open ticket", async () => {
  db.tickets.push({ id: 2041, requester: { id: 101, name: "Ananya Iyer" }, subject: "Refund", status: "pending", assignee: "ResolveAI Bot", tags: [], level: "high", handled_by: "high", created_at: new Date().toISOString() });
  const svc = service(scripted([triage({ kind: "status_check", intent: "refund" }), { text: "Ticket #2041 is still being worked on." }]));
  const res = await chat(svc, "s-new-chat", "what's happening with my request?");
  expect(res.body).toMatchObject({ ticket_id: 2041 });
  expect(db.tickets).toHaveLength(1);
});

test("one ticket per session; follow-ups are added as customer comments", async () => {
  const svc = service(
    scripted([
      triage({ intent: "other", confidence: 0.9 }),
      { text: "Which order is it?" },
      triage({ intent: "damaged_item", order_id: 1023 }),
      { text: "Thanks, looking now." },
    ]),
  );
  const first = await chat(svc, "s-follow", "Something is wrong");
  const second = await chat(svc, "s-follow", "Order 1023");

  expect(first.body).toMatchObject({ ticket_id: 2041 });
  expect(second.body).toMatchObject({ ticket_id: 2041 });
  expect(db.tickets).toHaveLength(1);
  expect(db.comments).toContainEqual({ ticket_id: 2041, body: "Order 1023", public: true, author: "Ananya Iyer", author_type: "customer" });
});

test("a ticket a person already owns: the message is passed on, the AI doesn't act", async () => {
  const svc = service(scripted([triage({ intent: "payment_failed", order_id: 1060 }), triage({ intent: "refund", order_id: 1023 })]));
  await chat(svc, "s-owned", "₹15,000 debited!");
  const res = await chat(svc, "s-owned", "Also refund my mugs");

  expect(res.body).toMatchObject({ reply: expect.stringContaining("Priya") });
  expect(db.orders[0]!.payment_status).toBe("paid");
  expect(db.runs[1]).toMatchObject({ status: "escalated", handled_by: "human" });
});

test("after a demo reset, an open chat gets a new ticket instead of reusing a recycled ticket number", async () => {
  const svc = service(scripted([triage({ intent: "question" }), { text: "Hi!" }, triage({ intent: "question" }), { text: "Hello again." }]));
  await chat(svc, "s-reset", "First message");

  // `bun run reset` wipes tickets and someone else's new chat gets #2041.
  db.tickets = [{ id: 2041, requester: { id: 104, name: "Sneha Kulkarni" }, created_at: "2030-01-01T00:00:00.000Z", status: "open", tags: [] }];
  db.comments = [];
  const res = await chat(svc, "s-reset", "Still there?");

  expect(res.body).toMatchObject({ ticket_id: 2042 });
  expect(db.comments.filter((c) => c.ticket_id === 2041)).toEqual([]);
});

/* ───── Out of scope and missing data ───── */

test("out of scope: a polite answer, no ticket, no agent, nobody pulled in", async () => {
  const svc = service(scripted([triage({ intent: "out_of_scope", summary: "Asks for a joke" })]));
  const res = await chat(svc, "s-oos", "Tell me a joke");

  expect(res).toEqual({ status: 200, body: { reply: expect.stringContaining("I can only help with ShopKart orders") } });
  expect(db.tickets).toHaveLength(0);
  expect(db.runs[0]).toMatchObject({ intent: "out_of_scope", status: "resolved", ticket_id: null });
  expect(db.steps.at(-1)).toMatchObject({ step: "Out of scope", agent: "main" });
  expect(db.cases).toHaveLength(0);
});

test("out of scope in a chat that already has a ticket: the exchange is added there, nothing else changes", async () => {
  const svc = service(scripted([triage({ intent: "question" }), { text: "Happy to help." }, triage({ intent: "out_of_scope" })]));
  await chat(svc, "s-oos2", "Hi there");
  const res = await chat(svc, "s-oos2", "What's the weather in Pune?");

  expect(res.body).toMatchObject({ ticket_id: 2041 });
  expect(db.tickets).toHaveLength(1);
  expect(db.comments.at(-2)).toMatchObject({ body: "What's the weather in Pune?", author_type: "customer" });
  expect(db.comments.at(-1)!.body).toContain("I can only help with ShopKart");
});

test("no data: a status check with no earlier request goes to the team, and the customer is told", async () => {
  const svc = service(scripted([triage({ kind: "status_check", intent: "refund" })]));
  const res = await chat(svc, "s-nodata", "Any update on my refund?");

  expect(res.body).toMatchObject({ reply: expect.stringContaining("passed it to our support team (ticket #2041)"), ticket_id: 2041 });
  expect(db.tickets[0]).toMatchObject({ assignee: "Karan – Support", handled_by: "human", status: "open" });
  expect(db.tickets[0]!.tags).toContain("needs-data");
  expect(db.comments.find((c) => !c.public)!.body).toContain("no earlier request");
  expect(db.runs[0]).toMatchObject({ status: "escalated", handled_by: "human" });
});

test("no data: an order question from a customer with no orders goes to the team without an agent", async () => {
  const svc = service(scripted([triage({ intent: "order_tracking" })]));
  const res = await chat(svc, "s-noorders", "Where is my order?", 105);

  expect(res.body).toMatchObject({ reply: expect.stringContaining("They're looking into it") });
  expect(db.tickets[0]).toMatchObject({ assignee: "Karan – Support", handled_by: "human" });
  expect(db.steps.map((s) => s.step)).toEqual(["Receive request", "Triage", "Hand to team"]);
});

test("no data: an order number that isn't on the customer's account goes to the team in code, not to an agent", async () => {
  const svc = service(scripted([triage({ intent: "order_tracking", order_id: 9999 })]));
  const res = await chat(svc, "s-9999-code", "Where is my order 9999?");

  expect(res.body).toMatchObject({ reply: expect.stringContaining("passed it to our support team") });
  expect(db.tickets[0]).toMatchObject({ assignee: "Karan – Support", handled_by: "human" });
  expect(db.comments.find((c) => !c.public)!.body).toContain("order #9999, which isn't on their account");
});

test("no data: an unknown order number in the message is caught in code even if the model leaves it out", async () => {
  const svc = service(scripted([triage({ intent: "order_tracking", order_id: null })]));
  await chat(svc, "s-9999-regex", "Where is my order no. #9999?");
  expect(db.tickets[0]).toMatchObject({ assignee: "Karan – Support", handled_by: "human" });
});

test("no data: when the level agent can't find what it needs, it hands over and says the team is on it", async () => {
  const svc = service(
    scripted([
      triage({ intent: "question", order_id: null, summary: "Asks if the headphones come in blue" }),
      { tool: "escalate_to_human", args: { assignee: "Karan – Support", priority: "normal", note: "Customer asks whether the headphones come in blue; product colours aren't in my tools." } },
      { text: "I don't have that detail to hand, so our team is looking into it and will get back to you here (ticket #2041)." },
    ]),
  );
  await chat(svc, "s-colour", "Do the headphones come in blue?");

  expect(db.tickets[0]).toMatchObject({ assignee: "Karan – Support", handled_by: "human", escalated_by_ai: true });
  expect(db.comments.at(-1)!.body).toContain("our team is looking into it");
  expect(db.runs[0]).toMatchObject({ status: "escalated" });
});

/* ───── Failures ───── */

test("if the model fails, the customer still gets an answer and the ticket goes to a person", async () => {
  const res = await chat(service(failing()), "s-fail", "Hello?");

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ticket_id: 2041 });
  expect(db.tickets[0]).toMatchObject({ assignee: null, handled_by: "human" });
  expect(db.comments.find((c) => !c.public)!.body).toContain("couldn't read the request");
  expect(db.runs[0]).toMatchObject({ status: "failed" });
});

test("a connector turned off in the Control Room stops the agent cleanly", async () => {
  db.connectors.find((c) => c.id === "zendesk")!.enabled = false;
  const res = await chat(service(scripted([triage({ intent: "question" }), { text: "hi" }])), "s-off", "hi");
  expect(res.status).toBe(502);
  expect((res.body as { error: string }).error).toContain("Zendesk connector is turned off");
});

test("demo API down → 502", async () => {
  const res = await chat(service(scripted([]), "http://127.0.0.1:1", fetch), "s-down", "hi");
  expect(res.status).toBe(502);
  expect((res.body as { error: string }).error).toContain("Can't reach the demo API");
});

test("bad input is rejected with 400", async () => {
  const svc = service(scripted([]));
  expect((await svc.intake(TOKEN, { session_id: "x", customer_id: 101 })).status).toBe(400);
  expect((await svc.lead({ name: "A", email: "not-an-email" })).status).toBe(400);
});

/* ───── Sales ───── */

test("lead: creates contact and deal, the agent scores it and books a call", async () => {
  const svc = service(
    scripted([
      { tool: "get_free_slots" },
      { tool: "book_meeting", args: { start: "2026-11-17T05:30:00.000Z" } },
      { tool: "update_deal", args: { score: "hot", stage: "meeting_booked", next_step: "Intro call Mon 11:00" } },
      { tool: "add_deal_note", args: { body: "Hot: ₹50,000 budget, starting this month." } },
      { text: "Thanks Meera! I've booked an intro call for Mon 17 Nov, 11:00 am." },
    ]),
  );
  const res = await svc.lead({
    name: "Meera Shah",
    phone: "9800000000",
    email: "meera@example.com",
    business_name: "Shah Traders",
    need: "bulk_order",
    budget: 50000,
    start_when: "This month",
  });

  expect(res).toEqual({ status: 201, body: { ok: true, message: "Thanks Meera! I've booked an intro call for Mon 17 Nov, 11:00 am.", deal_id: 9 } });
  expect(db.deals[0]).toMatchObject({ name: "Shah Traders – Bulk order", amount: 50000, score: "hot", stage: "meeting_booked" });
  expect(db.meetings).toHaveLength(1);
});

/* ───── Analysis agent ───── */

const INSIGHTS = [
  { dataset: "tickets_per_day", title: "AI handled 60% of tickets", finding: "6 of 10 tickets stayed with the AI.", tone: "good" },
  { dataset: "campaign_performance", title: "₹83,350 spent, 0 leads yet", finding: "Run the leads agent on the new responses.", tone: "watch" },
  { dataset: "pipeline_by_score", title: "Pipeline steady", finding: "Keep following up hot deals.", tone: "good" },
];

test("analysis: reads the metrics and publishes one report", async () => {
  const svc = service(
    scripted([
      { tool: "get_metrics" },
      { tool: "get_previous_reports" },
      { tool: "publish_report", args: { headline: "AI handled 60% of tickets; campaigns have 0 leads yet.", insights: INSIGHTS } },
      { text: "Published the report." },
    ]),
  );
  const res = await svc.analyze({ focus: "How are campaigns doing?" });

  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ report: { id: 1, headline: "AI handled 60% of tickets; campaigns have 0 leads yet.", insights: INSIGHTS } });
  expect(db.reports).toHaveLength(1);
});

test("analysis: a second publish in the same run is refused", async () => {
  const svc = service(
    scripted([
      { tool: "publish_report", args: { headline: "First", insights: INSIGHTS } },
      { tool: "publish_report", args: { headline: "Second", insights: INSIGHTS } },
      { text: "Done." },
    ]),
  );
  const res = await svc.analyze({});
  expect(res.body).toMatchObject({ report: { headline: "First" } });
  expect(db.reports).toHaveLength(1);
});

test("analysis: a sales analysis may only write about sales charts", async () => {
  const sales = INSIGHTS.filter((i) => i.dataset !== "tickets_per_day");
  const svc = service(
    scripted([
      { tool: "publish_report", args: { headline: "Mixed", insights: INSIGHTS } }, // tickets_per_day is not a sales chart
      { tool: "publish_report", args: { headline: "Sales only", insights: [...sales, { ...sales[0]!, title: "Third" }] } },
      { text: "Done." },
    ]),
  );
  const res = await svc.analyze({ scope: "sales" });
  expect(res.body).toMatchObject({ report: { headline: "Sales only", scope: "sales" } });
  expect(db.reports).toHaveLength(1);
});

test("analysis: a finding about an unknown chart is rejected, and no report means 502", async () => {
  const svc = service(
    scripted([
      { tool: "publish_report", args: { headline: "x", insights: [...INSIGHTS, { dataset: "made_up_chart", title: "t", finding: "f", tone: "good" }] } },
      { text: "I could not publish." },
    ]),
  );
  const res = await svc.analyze({});
  expect(res.status).toBe(502);
  expect(db.reports).toHaveLength(0);
});

/* ───── Leads agent ───── */

/** Spam → skip, already in the CRM → skip, otherwise a hot lead. Tries to sneak in an amount too. */
const leadTriage = (prompt: string): Step => {
  if (/FREE iPhone/.test(prompt)) return { tool: "skip_response", args: { reason: "Spam: prize message with a link" } };
  if (/open deals/.test(prompt)) return { tool: "skip_response", args: { reason: "Already in the pipeline" } };
  return { tool: "create_lead", args: { score: "hot", deal_name: "Joshi Sweets – Bulk order", next_step: "Book a call this week", note: "₹90,000, this week.", amount: 9_999_999 } };
};

test("leads: converts real responses, skips spam and people already in the pipeline", async () => {
  const res = await service(byPrompt(leadTriage)).syncLeads({});

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ processed: 3, converted: 1, skipped: 2, failed: 0, remaining: 0 });
  expect(db.responses.map((r) => r.status)).toEqual(["converted", "skipped", "skipped"]);
  // The amount comes from the response's budget, not from the model.
  expect(db.deals).toEqual([expect.objectContaining({ name: "Joshi Sweets – Bulk order", amount: 90000, score: "hot", stage: "new_lead" })]);
  expect((res.body as Json).results[0]).toMatchObject({ response_id: 1, outcome: "converted", deal_id: 9, score: "hot" });
});

test("leads: respects the limit and reports what is left", async () => {
  const res = await service(byPrompt(leadTriage)).syncLeads({ limit: 1 });
  expect(res.body).toMatchObject({ processed: 1, remaining: 2 });
  expect(db.responses.filter((r) => r.status === "new")).toHaveLength(2);
});

test("leads: if the model fails, responses stay new for the next run", async () => {
  const res = await service(failing()).syncLeads({});
  expect(res.body).toMatchObject({ processed: 3, converted: 0, failed: 3, remaining: 3 });
  expect(db.responses.every((r) => r.status === "new")).toBe(true);
  expect(db.deals).toHaveLength(0);
});

test("leads: a response decided elsewhere mid-run is not converted twice", async () => {
  const raced = byPrompt((prompt) => {
    // Another sync run skips it while this one is still thinking.
    db.responses.find((r) => prompt.includes(`Campaign response #${r.id} `))!.status = "skipped";
    return { tool: "create_lead", args: { score: "warm", deal_name: "x", next_step: "y", note: "z" } };
  });
  const res = await service(raced).syncLeads({});
  expect(res.body).toMatchObject({ converted: 0, failed: 3 });
  expect(db.deals).toHaveLength(0);
});

/* ───── Memory ───── */

/** Every message text the model was shown on one call, system prompt included. */
const shown = (call: { prompt: unknown }) =>
  (call.prompt as Json[]).map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : m.content.map((c: Json) => c.text ?? "").join("")}`);

test("memory: the analysis agent sees a note about its last report, not the last run's raw history", async () => {
  const model = scripted([
    { tool: "publish_report", args: { headline: "First headline: AI handled 60%.", insights: INSIGHTS } },
    { text: "Published." },
    { tool: "publish_report", args: { headline: "Second headline.", insights: INSIGHTS } },
    { text: "Published again." },
  ]);
  const api = createDemoAPI("http://demo", fakeFetch);
  const { analysisMemory } = createAgentMemory(undefined); // in process
  const platform = createPlatform("http://demo", fakeFetch);
  const svc = createService({
    api,
    platform,
    main: createMainAgent(model),
    writer: createWriterAgent(model),
    levels: createLevelAgents(api, model, platform),
    sales: createSalesAgent(api, model),
    analysis: createAnalysisAgent(api, model, analysisMemory),
    leads: createLeadsAgent(api, model),
    analysisMemory,
    log: { warn() {}, error() {} },
  });

  await svc.analyze({ focus: "first question" });
  const note = await analysisMemory.getWorkingMemory(analysisThread("all"));
  expect(note).toContain("Headline: First headline: AI handled 60%.");
  expect(note).toContain("[good] AI handled 60% of tickets (tickets_per_day)");

  await svc.analyze({ focus: "second question" });
  const second = shown(model.doGenerateCalls[2]!).join("\n");
  expect(second).toContain("First headline: AI handled 60%."); // the note, via the system prompt
  expect(second).toContain("second question");
  expect(second).not.toContain("first question"); // contextLimit 0: no replay of the earlier run

  const after = await analysisMemory.getWorkingMemory(analysisThread("all"));
  expect(after).toContain("Headline: Second headline.");
  expect(after).toContain("## Report before that"); // the previous headline is kept, one level deep
});

test("memory: two replies from the same person share a thread and run one after another", async () => {
  db.responses.push(response(4, { name: "Meera Joshi", email: "MEERA@joshisweets.example ", company: "Joshi Sweets", budget: 20000, message: "Also need 50 small boxes." }));
  const model = byPrompt(leadTriage);
  await service(model).syncLeads({});

  const calls = model.doGenerateCalls.map((c) => (c.prompt as Json[]).map((m) => m.role as string));
  const prompts = model.doGenerateCalls.map(shown);
  // The first model call for each response: its only user line is that response's prompt.
  const firstCall = (id: number) => prompts.findIndex((lines) => lines.at(-1)!.startsWith("user:") && lines.at(-1)!.includes(`Campaign response #${id} `));
  const first = firstCall(1);
  const later = firstCall(4);
  // Meera's earlier run (#1) is finished before her later one (#4) starts, and #4 is shown it from the shared thread.
  expect(first).toBeGreaterThanOrEqual(0);
  expect(later).toBeGreaterThan(first);
  expect(calls[later]!.slice(1, -1)).toContain("assistant");
  // Someone else's run starts with an empty thread.
  expect(calls[firstCall(2)]!.slice(1, -1)).not.toContain("assistant");
});

test("memory: analysisNote keeps the report before last", () => {
  const report = (headline: string) => ({ id: 1, scope: "all" as const, headline, insights: [], author: "ResolveAI Bot", created_at: "2026-11-15T06:00:00.000Z", snapshot: METRICS.totals as any });
  const first = analysisNote(report("One"), null);
  const second = analysisNote(report("Two"), first);
  expect(second).toContain("Headline: Two");
  expect(second).toContain("## Report before that");
  expect(second).toContain("Headline: One");
  expect(analysisNote(report("Three"), second)).not.toContain("Headline: One"); // only one level deep
});

test("analysis: ₹ amounts are rewritten with Indian grouping", () => {
  expect(indianRupees("₹603,000 of ₹903000 and ₹1,20,000; ₹9,050/lead, ₹4.5 avg")).toBe("₹6,03,000 of ₹9,03,000 and ₹1,20,000; ₹9,050/lead, ₹4.5 avg");
});
