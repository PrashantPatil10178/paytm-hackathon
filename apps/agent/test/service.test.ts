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
import { createSalesAgent } from "../src/agents/sales.ts";
import { assessCriticality } from "../src/criticality.ts";
import { createDemoAPI } from "../src/demo-api.ts";
import { createPlatform } from "../src/platform.ts";
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
  };
});

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
  return createService({ api, platform, main: createMainAgent(model), writer: createWriterAgent(model), levels: createLevelAgents(api, model, platform), sales: createSalesAgent(api, model), log: quiet });
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
