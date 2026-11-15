/**
 * POST /chat and POST /lead.
 *
 * When AGENT_URL is set, both are forwarded to the real ResolveAI agent.
 * Without it (or if the agent is down) a small rule-based stand-in answers instead,
 * using the same Zendesk / CRM endpoints the agent would. That keeps the screens
 * demoable while the agent is still being built.
 */
import {
  BOT,
  ENQUIRY_NEEDS,
  rupees,
  type ChatRequest,
  type ChatResponse,
  type LeadRequest,
  type LeadResponse,
  type LeadScore,
  type Order,
  type Ticket,
} from "@ph/shared";
import { eq, schema as s } from "@ph/db";
import { createContact, createDeal, logActivity } from "./crm.ts";
import { db } from "./db.ts";
import { bad, body, CORS, handle, ok } from "./http.ts";
import { customerOrders, findCustomer, refundOrder } from "./shop.ts";
import { addComment, createTicket, findTicket, ticketExists, updateTicket } from "./zendesk.ts";

const AGENT_URL = process.env.AGENT_URL?.replace(/\/$/, "");
const AUTO_REFUND_LIMIT = 1000;

async function forward(path: string, payload: unknown): Promise<Response | null> {
  if (!AGENT_URL) return null;
  try {
    const res = await fetch(`${AGENT_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    const headers = { ...CORS, "content-type": res.headers.get("content-type") ?? "application/json", "x-answered-by": "agent" };
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
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

  let reply: string;
  if (intent === "payment" && order) {
    await addComment(ticket.id, {
      public: false,
      body: `Checked the payment gateway: ${rupees(order.amount)} captured from the customer's bank, but order #${order.id} never got a payment confirmation. That's above the ${rupees(AUTO_REFUND_LIMIT)} auto-refund limit, so handing to Payments for a manual reconcile.`,
    });
    await updateTicket(ticket.id, { assignee: "Priya – Support", priority: "urgent", status: "open", escalated_by_ai: true });
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
    await updateTicket(ticket.id, { assignee: "Priya – Support", status: "pending", escalated_by_ai: true });
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

/* ───── Routes ───── */

export const agentRoutes = {
  "/chat": {
    POST: handle(async (req) => {
      const b = await body<ChatRequest>(req);
      if (!b.session_id || !b.customer_id || !b.message?.trim()) throw bad("session_id, customer_id and message are required");
      const forwarded = await forward("/chat", b);
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
};

export const agentMode = AGENT_URL ? `forwarding to ${AGENT_URL}` : "built-in stand-in (set AGENT_URL to use the real agent)";
