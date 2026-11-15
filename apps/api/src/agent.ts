/**
 * POST /chat, POST /lead, POST /analysis and POST /campaigns/sync.
 *
 * When AGENT_URL is set, all four are forwarded to the real ResolveAI agent.
 * Without it (or if the agent is down) a small rule-based stand-in answers instead,
 * using the same Zendesk / CRM endpoints the agent would. That keeps the screens
 * demoable while the agent is still being built.
 */
import {
  BOT,
  ENQUIRY_NEEDS,
  rupees,
  type AnalysisInsight,
  type AnalysisRequest,
  type AnalysisResponse,
  type CampaignResponse,
  type ChatRequest,
  type ChatResponse,
  type LeadRequest,
  type LeadResponse,
  type LeadScore,
  type LeadSyncRequest,
  type LeadSyncResponse,
  type LeadSyncResult,
  type Order,
  type Ticket,
  SUPPORT_AGENTS,
} from "@ph/shared";
import { eq, schema as s } from "@ph/db";
import { computeMetrics, saveReport } from "./analytics.ts";
import { refundLimit } from "./controlroom.ts";
import { contactForEmail, convertResponse, listResponses, skipResponse } from "./campaigns.ts";
import { createContact, createDeal, logActivity } from "./crm.ts";
import { db } from "./db.ts";
import { bad, body, CORS, handle, ok } from "./http.ts";
import { shopkartChannelToken } from "./resolveai.ts";
import { customerOrders, findCustomer, refundOrder } from "./shop.ts";
import { addComment, createTicket, findTicket, ticketExists, updateTicket } from "./zendesk.ts";

const AGENT_URL = process.env.AGENT_URL?.replace(/\/$/, "");

async function forward(path: string, payload: unknown, { token, timeoutMs = 110_000 }: { token?: string; timeoutMs?: number } = {}): Promise<Response | null> {
  if (!AGENT_URL) return null;
  try {
    const res = await fetch(`${AGENT_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const headers = { ...CORS, "content-type": res.headers.get("content-type") ?? "application/json", "x-answered-by": "agent" };
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    // Slow is not down: the agent may still be acting on this request, so the stand-in must not act too
    // (it would open a second ticket and could refund twice). Only an unreachable agent falls back.
    if ((e as Error).name === "TimeoutError") {
      console.warn(`[agent] ${AGENT_URL}${path} is taking longer than ${timeoutMs / 1000} s`);
      if (path === "/intake") return ok({ reply: "Sorry, this is taking a little longer than usual. I'm still on it and will update you here shortly." });
      return Response.json({ error: "The agent is still working on this; try again in a minute." }, { status: 504, headers: CORS });
    }
    console.warn(`[agent] ${AGENT_URL}${path} failed, using the built-in stand-in:`, (e as Error).message);
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ───────────── Chat stand-in ───────────── */

type Intent = "payment" | "refund" | "track" | "other";

function intentOf(msg: string): Intent {
  const m = msg.toLowerCase();
  if (/debit|deduct|payment (has )?fail|failed payment|money (was )?(taken|cut)|15,?000/.test(m)) return "payment";
  if (/damag|broke|crack|refund|defect|return/.test(m)) return "refund";
  if (/where|track|status|deliver|when will|arriv/.test(m)) return "track";
  return "other";
}

async function pickOrder(customerId: number, msg: string, intent: Intent): Promise<Order | undefined> {
  const mine = await customerOrders(customerId);
  const mentioned = msg.match(/#?\b(1\d{3})\b/)?.[1];
  if (mentioned) {
    const hit = mine.find((o) => o.id === Number(mentioned));
    if (hit) return hit;
  }
  if (intent === "payment") return mine.find((o) => o.payment_status === "failed_debited");
  if (intent === "refund") return mine.find((o) => o.status === "damaged") ?? mine.find((o) => o.status === "delivered");
  if (intent === "track") return mine.find((o) => o.status === "placed" || o.status === "shipped") ?? mine[0];
  return undefined;
}

const itemsText = (o: Order) => o.items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(", ");

function trackingReply(o: Order): string {
  switch (o.status) {
    case "placed":
      return `Order #${o.id} (${itemsText(o)}) is packed and will ship within 24 hours. You'll get the tracking link by SMS.`;
    case "shipped":
      return `Order #${o.id} is on its way and should reach you in 1–2 days.`;
    case "delivered":
      return `Order #${o.id} was delivered on ${new Date(o.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.`;
    case "damaged":
      return `Order #${o.id} was delivered but marked as damaged. I can start a refund for you. Just say "refund".`;
  }
}

async function simulateChat(req: ChatRequest): Promise<ChatResponse> {
  const customer = await findCustomer(req.customer_id);
  const intent = intentOf(req.message);
  const order = await pickOrder(customer.id, req.message, intent);

  // One ticket per chat session, like a real messaging integration.
  let ticket: Ticket;
  const [session] = await db.select().from(s.chatSessions).where(eq(s.chatSessions.session_id, req.session_id));
  if (session && (await ticketExists(session.ticket_id))) {
    ticket = await findTicket(session.ticket_id);
    await addComment(ticket.id, { body: req.message, public: true, author: customer.name, author_type: "customer" });
    if (ticket.status === "solved") await updateTicket(ticket.id, { status: "open" });
  } else {
    const subject =
      intent === "payment" && order ? `Payment failed but ${rupees(order.amount)} debited – order #${order.id}`
      : intent === "refund" && order ? `Damaged item, refund requested – order #${order.id}`
      : intent === "track" && order ? `Where is my order #${order.id}?`
      : req.message.length > 60 ? `${req.message.slice(0, 57)}…` : req.message;
    ticket = await createTicket({
      subject,
      comment: req.message,
      requester_id: customer.id,
      via: "chat",
      assignee: BOT,
      status: "open",
      order_id: order?.id ?? null,
      type: intent === "track" || intent === "other" ? "question" : "incident",
      priority: intent === "payment" ? "critical" : intent === "refund" ? "medium" : "low",
      tags: [intent === "track" ? "wismo" : intent, "chat"],
    });
    await db
      .insert(s.chatSessions)
      .values({ session_id: req.session_id, ticket_id: ticket.id })
      .onConflictDoUpdate({ target: s.chatSessions.session_id, set: { ticket_id: ticket.id } });
  }

  await sleep(900 + Math.random() * 900); // let the typing indicator breathe

  // The auto-refund limit is a Control Room setting (₹1,000 unless someone changed it).
  const AUTO_REFUND_LIMIT = await refundLimit();
  let reply: string;
  if (intent === "payment" && order) {
    await addComment(ticket.id, {
      public: false,
      body: `Checked the payment gateway: ${rupees(order.amount)} captured from the customer's bank, but order #${order.id} never got a payment confirmation. That's above the ${rupees(AUTO_REFUND_LIMIT)} auto-refund limit, so handing to Payments for a manual reconcile.`,
    });
    await updateTicket(ticket.id, { assignee: SUPPORT_AGENTS[0], priority: "urgent", status: "open", escalated_by_ai: true });
    reply = `I can see ${rupees(order.amount)} left your bank for order #${order.id}, but the payment never reached us. Amounts this large need a person to check, so I've passed this to Priya on our payments team with all the details. You'll hear back within 2 hours. Your ticket number is #${ticket.id}.`;
  } else if (intent === "refund" && order) {
    const refundable = (order.status === "damaged" || order.status === "delivered") && (order.payment_status === "paid" || order.payment_status === "cod");
    if (order.amount <= AUTO_REFUND_LIMIT && refundable) {
      await refundOrder(order.id);
      await addComment(ticket.id, {
        public: false,
        body: `Policy check passed: delivered order, damage reported within 7 days, ${rupees(order.amount)} is under the ${rupees(AUTO_REFUND_LIMIT)} auto-refund limit. Refund started to the original payment method.`,
      });
      reply = `Sorry order #${order.id} (${itemsText(order)}) arrived damaged. I've started a refund of ${rupees(order.amount)} to your original payment method. It should reach you in 3–5 working days. No need to send anything back.`;
      await addComment(ticket.id, { public: true, body: reply });
      await updateTicket(ticket.id, { status: "solved" });
      return { reply, ticket_id: ticket.id };
    }
    await addComment(ticket.id, { public: false, body: `Refund of ${rupees(order.amount)} is above the auto-refund limit. Needs approval from a person.` });
    await updateTicket(ticket.id, { assignee: SUPPORT_AGENTS[0], status: "pending", escalated_by_ai: true });
    reply = `I've raised a refund request for order #${order.id}. As it's ${rupees(order.amount)}, a teammate needs to approve it. You'll hear back within a day.`;
  } else if (intent === "track" && order) {
    reply = trackingReply(order);
    await addComment(ticket.id, { public: true, body: reply });
    await updateTicket(ticket.id, { status: "solved" });
    return { reply, ticket_id: ticket.id };
  } else {
    reply = `Thanks, ${customer.name.split(" ")[0]}. I've noted this as ticket #${ticket.id}. Could you share the order number so I can look into it?`;
    await updateTicket(ticket.id, { status: "pending" });
  }

  await addComment(ticket.id, { public: true, body: reply });
  return { reply, ticket_id: ticket.id };
}

/* ───────────── Lead stand-in ───────────── */

function scoreLead(b: LeadRequest): { score: LeadScore; why: string } {
  const soon = /now|immediate|this week|this month|asap|today/i.test(b.start_when);
  if (b.budget >= 40000 && soon) return { score: "hot", why: "budget fits and they want to start soon" };
  if (b.budget >= 20000 || soon) return { score: "warm", why: soon ? "wants to start soon, smaller budget" : "budget fits, no firm start date" };
  return { score: "cold", why: "small budget and no near start date" };
}

async function simulateLead(b: LeadRequest): Promise<LeadResponse> {
  const missing = (["name", "phone", "email", "business_name", "need"] as const).filter((k) => !String(b[k] ?? "").trim());
  if (missing.length) throw bad(`Missing: ${missing.join(", ")}`);
  const budget = Number(b.budget) || 0;
  const need = ENQUIRY_NEEDS.find((n) => n.id === b.need)?.label ?? "Enquiry";
  const contact = await createContact({
    name: b.name,
    email: b.email,
    phone: b.phone,
    company: b.business_name,
    source: "Business enquiry form",
  });
  const { score, why } = scoreLead({ ...b, budget });
  const deal = await createDeal({
    name: `${b.business_name} – ${need}`,
    amount: budget,
    contact_id: contact.id,
    score,
    next_step: score === "hot" ? "Book a call this week" : "Qualify on a short call",
  });
  await logActivity(deal.id, {
    type: "note",
    author: BOT,
    ai: true,
    body: `New lead from the business enquiry form. Need: ${need.toLowerCase()}. Budget ${rupees(budget)}. Wants to start: ${b.start_when || "not given"}. Scored ${score[0]!.toUpperCase() + score.slice(1)}: ${why}.`,
  });
  return { ok: true, message: "Thanks! Our team will contact you shortly.", deal_id: deal.id };
}

/* ───────────── Analysis stand-in ───────────── */

async function simulateAnalysis(req: AnalysisRequest): Promise<AnalysisResponse> {
  const scope = req.scope === "sales" ? "sales" : "all";
  const { totals: t, datasets } = await computeMetrics();
  const campaigns = datasets.find((d) => d.id === "campaign_performance")!.rows;
  const insights: AnalysisInsight[] = [];

  if (scope === "all") insights.push({
    dataset: "tickets_per_day",
    title: `AI handled ${t.ai_rate.toFixed(0)}% of tickets`,
    finding: `${t.tickets_ai} of ${t.tickets} tickets stayed with the AI; ${t.tickets_escalated} were escalated to a person. ${t.tickets_open} are still open.`,
    tone: t.ai_rate >= 60 ? "good" : t.ai_rate >= 40 ? "watch" : "risk",
  });
  insights.push({
    dataset: "pipeline_by_score",
    title: `${rupees(t.pipeline_open)} in open pipeline`,
    finding: `${t.deals_open} open deals, ${t.hot_open} of them hot. ${rupees(t.won_value)} closed won so far.`,
    tone: t.hot_open > 0 ? "good" : "watch",
  });
  const best = [...campaigns].sort((a, b) => Number(b.responses) - Number(a.responses))[0];
  if (best) {
    insights.push({
      dataset: "campaign_performance",
      title: `${best.label} brings the most responses`,
      finding: `${best.responses} responses for ${rupees(Number(best.spend))} spent. ${t.campaign_leads} campaign leads created overall${t.cost_per_lead ? `, ${rupees(t.cost_per_lead)} per lead` : ""}.`,
      tone: t.campaign_leads > 0 ? "good" : "watch",
    });
  }
  if (scope === "sales") {
    const won = datasets.find((d) => d.id === "deals_by_stage")!.rows.find((r) => r.key === "closed_won");
    insights.push({
      dataset: "deals_by_stage",
      title: `${rupees(t.won_value)} closed won`,
      finding: `${won?.deals ?? 0} deals won so far against ${rupees(t.pipeline_open)} still open. Push the qualified and meeting-booked deals toward a quote.`,
      tone: t.won_value > 0 ? "watch" : "risk",
    });
  } else insights.push({
    dataset: "orders_per_day",
    title: `${rupees(t.revenue_14d)} revenue in 14 days`,
    finding: `${t.orders_14d} orders in the last 14 days. ${t.refunds} orders refunded or being refunded.`,
    tone: t.refunds > 2 ? "watch" : "good",
  });

  const report = await saveReport({
    scope,
    headline:
      scope === "sales"
        ? `${rupees(t.pipeline_open)} open pipeline with ${t.hot_open} hot deals; ${t.campaign_leads} campaign leads${t.cost_per_lead ? ` at ${rupees(t.cost_per_lead)} each` : ""}.`
        : `AI handled ${t.ai_rate.toFixed(0)}% of tickets; ${rupees(t.pipeline_open)} open pipeline with ${t.hot_open} hot deals.`,
    insights,
    author: "Rules",
  });
  return { report };
}

/* ───────────── Campaign leads stand-in ───────────── */

const SPAM = /\b(win|free|prize|click|lottery|offer)\b|bit\.ly|https?:\/\//i;

async function simulateLeadSync(req: LeadSyncRequest): Promise<LeadSyncResponse> {
  const limit = Math.min(25, Math.max(1, Number(req.limit) || 10));
  const queue = await listResponses({ status: "new" });
  const results: LeadSyncResult[] = [];

  for (const r of queue.slice(0, limit)) {
    const base = { response_id: r.id, name: r.name, company: r.company, campaign: r.campaign.name };
    const reason = await skipReason(r);
    if (reason) {
      await skipResponse(r.id, { reason });
      results.push({ ...base, outcome: "skipped", reason });
      continue;
    }
    const { score, why } = scoreLead({ ...r, business_name: r.company, budget: r.budget ?? 0 });
    const need = ENQUIRY_NEEDS.find((x) => x.id === r.need)?.label ?? "Enquiry";
    const res = await convertResponse(r.id, {
      score,
      deal_name: `${r.company} – ${need}`,
      amount: r.budget ?? 0,
      next_step: score === "hot" ? "Book a call this week" : score === "warm" ? "Qualify on a short call" : "Send intro email",
      note: `Scored ${score}: ${why}.`,
    });
    results.push({ ...base, outcome: "converted", deal_id: res.deal.id, score, reason: `Scored ${score}: ${why}` });
  }

  return {
    processed: results.length,
    converted: results.filter((x) => x.outcome === "converted").length,
    skipped: results.filter((x) => x.outcome === "skipped").length,
    failed: 0,
    remaining: Math.max(0, queue.length - results.length),
    results,
  };
}

async function skipReason(r: CampaignResponse): Promise<string | null> {
  if (!r.company.trim() || r.message.trim().length < 12 || /^test\b/i.test(r.name) || SPAM.test(r.message)) return "Looks like spam or a test entry";
  const known = await contactForEmail(r.email);
  const live = known?.deals.find((d) => d.stage !== "closed_won" && d.stage !== "closed_lost");
  if (live) return `Already in the pipeline as deal #${live.id} (${live.name})`;
  return null;
}

/* ───── Routes ───── */

export const agentRoutes = {
  "/chat": {
    POST: handle(async (req) => {
      const b = await body<ChatRequest>(req);
      if (!b.session_id || !b.customer_id || !b.message?.trim()) throw bad("session_id, customer_id and message are required");
      // ShopKart is a ResolveAI channel: its chats go to the agent's intake with the channel token.
      const forwarded = await forward("/intake", b, { token: shopkartChannelToken() });
      if (forwarded) return forwarded;
      return ok(await simulateChat({ ...b, message: b.message.trim() }));
    }),
  },
  "/lead": {
    POST: handle(async (req) => {
      const b = await body<LeadRequest>(req);
      const forwarded = await forward("/lead", b);
      if (forwarded) return forwarded;
      return ok(await simulateLead(b), 201);
    }),
  },
  "/analysis": {
    POST: handle(async (req) => {
      const b = await body<AnalysisRequest>(req).catch(() => ({}));
      const forwarded = await forward("/analysis", b, { timeoutMs: 120_000 });
      if (forwarded) return forwarded;
      return ok(await simulateAnalysis(b), 201);
    }),
  },
  "/campaigns/sync": {
    POST: handle(async (req) => {
      const b = await body<LeadSyncRequest>(req).catch(() => ({}));
      // One model run per response: give the agent time to work through a batch.
      const forwarded = await forward("/campaigns/sync", b, { timeoutMs: 300_000 });
      if (forwarded) return forwarded;
      return ok(await simulateLeadSync(b));
    }),
  },
};

export const agentMode = AGENT_URL ? `forwarding to ${AGENT_URL}` : "built-in stand-in (set AGENT_URL to use the real agent)";
