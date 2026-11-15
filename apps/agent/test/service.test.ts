/**
 * Runs the real agents and service against an in-memory fake of the demo API and a scripted model,
 * so no other services or API keys are needed.
 */
import { beforeEach, expect, test } from "bun:test";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createSalesAgent } from "../src/agents/sales.ts";
import { createSupportAgent } from "../src/agents/support.ts";
import { createDemoAPI } from "../src/demo-api.ts";
import { createService } from "../src/service.ts";

/* ───── Fake demo API ───── */

type Json = Record<string, any>;
let db: { tickets: Json[]; comments: Json[]; orders: Json[]; contacts: Json[]; deals: Json[]; notes: Json[]; meetings: Json[] };

beforeEach(() => {
  db = {
    tickets: [],
    comments: [],
    orders: [
      { id: 1023, customer_id: 101, status: "delivered", payment_status: "paid", amount: 500, items: [{ name: "Mug", qty: 2 }], placed_at: "2026-11-10", updated_at: "2026-11-13" },
      { id: 1030, customer_id: 101, status: "delivered", payment_status: "paid", amount: 4200, items: [{ name: "Lamp", qty: 1 }], placed_at: "2026-11-09", updated_at: "2026-11-12" },
      { id: 1040, customer_id: 102, status: "delivered", payment_status: "paid", amount: 300, items: [{ name: "Tea", qty: 1 }], placed_at: "2026-11-09", updated_at: "2026-11-12" },
    ],
    contacts: [],
    deals: [],
    notes: [],
    meetings: [],
  };
});

const json = (data: unknown, status = 200) => Response.json(data, { status });

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const p = url.pathname;
  let m: RegExpMatchArray | null;

  if (method === "POST" && p === "/zendesk/tickets") {
    const t = { id: 2041 + db.tickets.length, requester: { id: body.requester_id, name: "Ananya Iyer" }, escalated_by_ai: false, created_at: new Date().toISOString(), ...body };
    db.tickets.push(t);
    return json(t, 201);
  }
  if ((m = p.match(/^\/zendesk\/tickets\/(\d+)$/))) {
    const t = db.tickets.find((x) => x.id === Number(m![1]));
    if (!t) return json({ error: "Ticket not found" }, 404);
    if (method === "PATCH") {
      if (body.assignee && t.assignee === "ResolveAI Bot" && body.assignee !== "ResolveAI Bot") t.escalated_by_ai = true;
      Object.assign(t, body);
    }
    return json(t);
  }
  if ((m = p.match(/^\/zendesk\/tickets\/(\d+)\/comments$/))) {
    db.comments.push({ ticket_id: Number(m[1]), ...body });
    return json({ id: db.comments.length }, 201);
  }
  if ((m = p.match(/^\/shop\/customers\/(\d+)\/orders$/))) {
    return json({ customer: { id: Number(m[1]), name: "Ananya Iyer" }, orders: db.orders.filter((o) => o.customer_id === Number(m![1])) });
  }
  if ((m = p.match(/^\/shop\/orders\/(\d+)(\/refund)?$/))) {
    const o = db.orders.find((x) => x.id === Number(m![1]));
    if (!o) return json({ error: "Order not found" }, 404);
    if (m[2]) Object.assign(o, { status: "damaged", payment_status: "refund_initiated" });
    return json(o);
  }
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
  return json({ error: `${method} ${p} not found` }, 404);
}) as typeof fetch;

/* ───── Scripted model ───── */

type Step = { tool: string; args?: Json } | { text: string };
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

/** A model that plays the given steps in order: tool calls, then a final text. */
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

const failing = () =>
  new MockLanguageModelV3({
    doGenerate: async () => {
      // What a provider throws for a bad key: not retryable.
      throw new APICallError({ message: "401 invalid x-api-key", url: "https://model", requestBodyValues: {}, statusCode: 401, isRetryable: false });
    },
  });

function service(model: ReturnType<typeof scripted>) {
  const api = createDemoAPI("http://demo", fakeFetch);
  const quiet = { warn() {}, error() {} };
  return createService({ api, support: createSupportAgent(api, model), sales: createSalesAgent(api, model), log: quiet });
}

/* ───── Tests ───── */

test("chat: refunds a small damaged order, solves the ticket and posts the reply", async () => {
  const svc = service(
    scripted([
      { tool: "get_customer_orders" },
      { tool: "start_refund", args: { order_id: 1023, reason: "mugs arrived broken" } },
      { tool: "update_ticket", args: { subject: "Damaged item, refund requested – order #1023", status: "solved", tags: ["chat", "refund"] } },
      { text: "Sorry about the mugs! I've started a refund of ₹500." },
    ]),
  );
  const res = await svc.chat({ session_id: "s1", customer_id: 101, message: "My mugs arrived broken" });

  expect(res).toEqual({ status: 200, body: { reply: "Sorry about the mugs! I've started a refund of ₹500.", ticket_id: 2041 } });
  expect(db.orders[0]!.payment_status).toBe("refund_initiated");
  expect(db.tickets[0]).toMatchObject({ status: "solved", subject: "Damaged item, refund requested – order #1023" });
  expect(db.comments.filter((c) => !c.public)[0]!.body).toContain("Refund of ₹500 started");
  expect(db.comments.at(-1)).toEqual({ ticket_id: 2041, body: "Sorry about the mugs! I've started a refund of ₹500.", public: true });
});

test("chat: the refund tool refuses above the limit, whatever the model asks", async () => {
  const svc = service(
    scripted([
      { tool: "start_refund", args: { order_id: 1030, reason: "lamp broken" } },
      { tool: "escalate_to_human", args: { assignee: "Priya – Support", priority: "high", note: "Lamp refund of ₹4,200 needs approval." } },
      { text: "A teammate will approve your refund within a day." },
    ]),
  );
  await svc.chat({ session_id: "s2", customer_id: 101, message: "Lamp broken, refund please" });

  expect(db.orders[1]!.payment_status).toBe("paid");
  expect(db.tickets[0]).toMatchObject({ assignee: "Priya – Support", escalated_by_ai: true });
});

test("chat: tools can't touch another customer's order", async () => {
  const svc = service(scripted([{ tool: "start_refund", args: { order_id: 1040, reason: "x" } }, { text: "ok" }]));
  await svc.chat({ session_id: "s3", customer_id: 101, message: "refund order 1040" });
  expect(db.orders[2]!.payment_status).toBe("paid");
});

test("chat: one ticket per session; follow-ups are added as customer comments", async () => {
  const svc = service(scripted([{ text: "Which order is it?" }, { text: "Thanks, looking now." }]));
  const first = await svc.chat({ session_id: "s4", customer_id: 101, message: "Something is wrong" });
  const second = await svc.chat({ session_id: "s4", customer_id: 101, message: "Order 1023" });

  expect(first.body).toMatchObject({ ticket_id: 2041 });
  expect(second.body).toMatchObject({ ticket_id: 2041 });
  expect(db.tickets).toHaveLength(1);
  expect(db.comments).toContainEqual({ ticket_id: 2041, body: "Order 1023", public: true, author: "Ananya Iyer", author_type: "customer" });
});

test("chat: if the model fails, the customer still gets an answer and the ticket goes to a person", async () => {
  const res = await service(failing()).chat({ session_id: "s5", customer_id: 101, message: "Hello?" });

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ticket_id: 2041 });
  expect(db.tickets[0]!.assignee).toBeNull();
  expect(db.comments.find((c) => !c.public)!.body).toContain("401 invalid x-api-key");
});

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

test("chat: after a demo reset, an open chat gets a new ticket instead of reusing a recycled ticket number", async () => {
  const svc = service(scripted([{ text: "Hi!" }, { text: "Hello again." }]));
  await svc.chat({ session_id: "s7", customer_id: 101, message: "First message" });

  // `bun run reset` wipes tickets and someone else's new chat gets #2041.
  db.tickets = [{ id: 2041, requester: { id: 104, name: "Sneha Kulkarni" }, created_at: "2030-01-01T00:00:00.000Z", status: "open" }];
  db.comments = [];
  const res = await svc.chat({ session_id: "s7", customer_id: 101, message: "Still there?" });

  expect(res.body).toMatchObject({ ticket_id: 2042 });
  expect(db.comments.filter((c) => c.ticket_id === 2041)).toEqual([]);
});

test("bad input is rejected with 400", async () => {
  const svc = service(scripted([]));
  expect((await svc.chat({ session_id: "x", customer_id: 101 })).status).toBe(400);
  expect((await svc.lead({ name: "A", email: "not-an-email" })).status).toBe(400);
});

test("demo API down → 502", async () => {
  const api = createDemoAPI("http://127.0.0.1:1");
  const model = scripted([]);
  const svc = createService({ api, support: createSupportAgent(api, model), sales: createSalesAgent(api, model), log: { warn() {}, error() {} } });
  const res = await svc.chat({ session_id: "s6", customer_id: 101, message: "hi" });
  expect(res.status).toBe(502);
  expect((res.body as { error: string }).error).toContain("Can't reach the demo API");
});
