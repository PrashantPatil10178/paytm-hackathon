/**
 * Runs the real agents and service against an in-memory fake of the demo API and a scripted model,
 * so no other services or API keys are needed.
 */
import { beforeEach, expect, test } from "bun:test";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createAnalysisAgent } from "../src/agents/analysis.ts";
import { createLeadsAgent } from "../src/agents/leads.ts";
import { createSalesAgent } from "../src/agents/sales.ts";
import { createSupportAgent } from "../src/agents/support.ts";
import { createDemoAPI } from "../src/demo-api.ts";
import { analysisNote, analysisThread, createAgentMemory } from "../src/memory.ts";
import { indianRupees } from "../src/tools/analysis.ts";
import { createService } from "../src/service.ts";

/* ───── Fake demo API ───── */

type Json = Record<string, any>;
let db: { tickets: Json[]; comments: Json[]; orders: Json[]; contacts: Json[]; deals: Json[]; notes: Json[]; meetings: Json[]; responses: Json[]; reports: Json[]; requests: Json[] };

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
    ],
    contacts: [],
    deals: [],
    notes: [],
    meetings: [],
    responses: [
      response(1, { name: "Meera Joshi", email: "meera@joshisweets.example", company: "Joshi Sweets", budget: 90000, start_when: "This week", message: "Need 500 Diwali hampers with our logo." }),
      response(2, { name: "Promo Blast", email: "noreply@promo.example", company: "", need: "other", message: "WIN a FREE iPhone!!! bit.ly/xx" }),
      response(3, { name: "Rakesh Sharma", email: "rakesh@sharmarestaurants.example", company: "Sharma Restaurants", need: "billing_setup", budget: 50000, message: "Still interested in billing." }),
    ],
    reports: [],
    requests: [],
  };
});

const METRICS = {
  generated_at: "2026-11-15T10:00:00.000Z",
  totals: { tickets: 10, tickets_ai: 6, ai_rate: 60, campaign_spend: 83350, campaign_leads: 0 },
  datasets: [{ id: "tickets_per_day", title: "Tickets per day", description: "x", series: [{ key: "ai", label: "AI", unit: "count" }], rows: [{ key: "2026-11-15", label: "15 Nov", ai: 6 }] }],
};

const json = (data: unknown, status = 200) => Response.json(data, { status });

const FORMS = [
  {
    id: "damaged_item", title: "Damaged or wrong item", ask: "Tell us which order it is and what went wrong.", active: true,
    use_for: "A damaged item when it isn't clear which order.",
    fields: [{ key: "order", kind: "order", label: "Which order?", enabled: true, required: true }, { key: "photo", kind: "photo", label: "Photo of the item", enabled: false, required: false }],
  },
  { id: "payment_problem", title: "Payment problem", ask: "Pick the order.", active: false, use_for: "Payments.", fields: [{ key: "utr", kind: "text", label: "Bank reference (UTR)", enabled: true, required: false }] },
];

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
  if (p === "/info/forms") return json({ forms: FORMS });
  if (method === "POST" && p === "/info/requests") {
    const f = FORMS.find((x) => x.id === body.form_id);
    if (!f) return json({ error: `Form "${body.form_id}" not found` }, 404);
    const r = { id: 1 + db.requests.length, title: f.title, ask: f.ask, fields: f.fields.filter((x) => x.enabled), status: "waiting", ...body };
    db.requests.push(r);
    return json(r, 201);
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

function service(model: ReturnType<typeof scripted>) {
  const api = createDemoAPI("http://demo", fakeFetch);
  const quiet = { warn() {}, error() {} };
  return createService({
    api,
    support: createSupportAgent(api, model),
    sales: createSalesAgent(api, model),
    analysis: createAnalysisAgent(api, model),
    leads: createLeadsAgent(api, model),
    log: quiet,
  });
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

test("chat: a phone call opens its ticket via voice and tells the agent the reply is spoken", async () => {
  let seen = "";
  const model = new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      seen = JSON.stringify(prompt);
      return textResult("Order 1023 was delivered on 13 November.");
    },
  });
  const res = await service(model).chat({ session_id: "voice-abc", customer_id: 101, message: "Where is my order?", channel: "voice" });

  expect(res.body).toMatchObject({ ticket_id: 2041 });
  expect(db.tickets[0]).toMatchObject({ via: "voice", tags: ["voice"] });
  expect(seen).toContain("phone call: your reply is spoken aloud");
});

test("chat: when the order isn't clear, Aria sends the team's form; the prompt lists only active forms", async () => {
  let seen = "";
  const steps: Step[] = [
    { tool: "get_customer_orders" },
    { tool: "request_details", args: { form_id: "damaged_item", order_ids: [1023, 1030] } },
    { text: "Sorry about that! Pick the order below and tell me what went wrong." },
  ];
  let i = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      if (i === 0) seen = JSON.stringify(prompt);
      const step = steps[i++]!;
      if ("text" in step) return textResult(step.text);
      return { content: [{ type: "tool-call", toolCallId: `call-${i}`, toolName: step.tool, input: JSON.stringify(step.args ?? {}) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] };
    },
  });
  const res = await service(model).chat({ session_id: "s-form", customer_id: 101, message: "Item damaged, I want a refund" });

  expect(res.body).toMatchObject({ ticket_id: 2041 });
  expect(db.requests).toEqual([expect.objectContaining({ ticket_id: 2041, form_id: "damaged_item", order_ids: [1023, 1030] })]);
  expect(seen).toContain("damaged_item");
  expect(seen).toContain("asks for which order");
  expect(seen).not.toContain("payment_problem"); // switched off in the Control Room
  expect(db.orders[0]!.payment_status).toBe("paid"); // nothing refunded on a guess
});

test("chat: on a phone call no form is sent; the tool tells Aria to ask out loud", async () => {
  const svc = service(scripted([{ tool: "request_details", args: { form_id: "damaged_item" } }, { text: "Which order is it?" }]));
  await svc.chat({ session_id: "voice-x", customer_id: 101, message: "Something arrived broken", channel: "voice" });
  expect(db.requests).toHaveLength(0);
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
  const svc = createService({
    api,
    support: createSupportAgent(api, model),
    sales: createSalesAgent(api, model),
    analysis: createAnalysisAgent(api, model),
    leads: createLeadsAgent(api, model),
    log: { warn() {}, error() {} },
  });
  const res = await svc.chat({ session_id: "s6", customer_id: 101, message: "hi" });
  expect(res.status).toBe(502);
  expect((res.body as { error: string }).error).toContain("Can't reach the demo API");
  expect((await svc.syncLeads({})).status).toBe(502);
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
const triage = (prompt: string): Step => {
  if (/FREE iPhone/.test(prompt)) return { tool: "skip_response", args: { reason: "Spam: prize message with a link" } };
  if (/open deals/.test(prompt)) return { tool: "skip_response", args: { reason: "Already in the pipeline" } };
  return { tool: "create_lead", args: { score: "hot", deal_name: "Joshi Sweets – Bulk order", next_step: "Book a call this week", note: "₹90,000, this week.", amount: 9_999_999 } };
};

test("leads: converts real responses, skips spam and people already in the pipeline", async () => {
  const res = await service(byPrompt(triage)).syncLeads({});

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ processed: 3, converted: 1, skipped: 2, failed: 0, remaining: 0 });
  expect(db.responses.map((r) => r.status)).toEqual(["converted", "skipped", "skipped"]);
  // The amount comes from the response's budget, not from the model.
  expect(db.deals).toEqual([expect.objectContaining({ name: "Joshi Sweets – Bulk order", amount: 90000, score: "hot", stage: "new_lead" })]);
  expect((res.body as Json).results[0]).toMatchObject({ response_id: 1, outcome: "converted", deal_id: 9, score: "hot" });
});

test("leads: respects the limit and reports what is left", async () => {
  const res = await service(byPrompt(triage)).syncLeads({ limit: 1 });
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
  const svc = createService({
    api,
    support: createSupportAgent(api, model),
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
  const model = byPrompt(triage);
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
