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
  liveOrders,
  ordersNamedIn,
  rupees,
  type AnalysisInsight,
  type AnalysisRequest,
  type AnalysisResponse,
  type CampaignResponse,
  type ChatQuestion,
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
  type AgentLevel,
  type HandledBy,
  type RunStatus,
  OWNER,
  SUPPORT_AGENTS,
} from "@ph/shared";
import { eq, schema as s } from "@ph/db";
import { computeMetrics, saveReport } from "./analytics.ts";
import { linkToChatMessage } from "./attachments.ts";
import { linkTicket, personActive, personOnChat, record, recordAria, type ChatRef } from "./chats.ts";
import { getSettings, refundLimit } from "./controlroom.ts";
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
  // Money: never pick the order for them. Only one they named (number or item), or their only order.
  if (intent === "refund") return ordersNamedIn(msg, mine)[0] ?? (mine.length === 1 ? mine[0] : undefined);
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
      return `Order #${o.id} was delivered on ${new Date(o.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}.`;
    case "damaged":
      return `Order #${o.id} was delivered but marked as damaged. I can start a refund for you. Just say "refund".`;
  }
}

/** "Which order?" before a refund when the customer didn't say: no ticket until they pick. */
function askWhichOrder(req: ChatRequest, orders: Order[]): ChatResponse {
  const ask: ChatQuestion = {
    kind: "order",
    prompt: "Which order is this about?",
    description: "Pick the order, so we look at the right one.",
    choices: liveOrders(orders).slice(0, 6).map((o) => ({ value: String(o.id), label: o.items[0]?.name ?? `Order #${o.id}`, description: `Order #${o.id} · ${o.status} · ${rupees(o.amount)}`, image: o.items[0]?.image })),
    other: { label: "A different order", placeholder: "Order number, e.g. 1047" },
    original: req.message,
  };
  return { reply: "Sure, I can help with that. Which order is it about?", ask };
}

type StepAgent = "main" | "low" | "medium" | "high" | "human";
type StandInStep = { agent: StepAgent; step: string; tool: string; result: "success" | "blocked" | "escalated"; detail: string };

/**
 * Every stand-in answer is a ResolveAI run with its steps, like the agent's, so the Control Room shows what
 * happened (level, who handles it, the trace) and counts it. Ticketless answers show under Conversations.
 */
async function recordRun(
  req: ChatRequest,
  message: string,
  r: { ticket_id: number | null; intent: string; level: AgentLevel | null; handled_by: HandledBy | null; status: RunStatus; reply: string; plan: string[]; reason?: string; steps: StandInStep[] },
) {
  const [run] = await db
    .insert(s.agentRuns)
    .values({ channel_id: "shopkart", session_id: req.session_id, customer_id: req.customer_id, ticket_id: r.ticket_id, message, kind: "request", intent: r.intent, level: r.level, level_reason: r.reason ?? null, handled_by: r.handled_by, status: r.status, plan: r.plan, reply: r.reply })
    .returning({ id: s.agentRuns.id });
  await db.insert(s.agentSteps).values([
    { run_id: run!.id, agent: "main" as const, step: "Receive request", tool: "ShopKart chat", result: "success" as const, detail: `${message.slice(0, 160)} (answered by the API's rule-based stand-in: the agent was unreachable)` },
    ...r.steps.map((x) => ({ run_id: run!.id, ...x })),
  ]);
}

const LEVEL_PRIORITY: Record<AgentLevel, AgentLevel> = { low: "low", medium: "medium", high: "high", critical: "critical" };

/**
 * The rule-based stand-in for the agent (used when AGENT_URL is unset or the agent is unreachable). It only does
 * what it can really do and says so: refunds within the limit on clean cases; everything else goes to the owner
 * with a note. It never promises an approval (it can't queue one), and it can't check photos, so a damage claim
 * that needs one is asked for it and then handed to a person.
 */
async function simulateChat(req: ChatRequest): Promise<ChatResponse> {
  const [customer, settings] = await Promise.all([findCustomer(req.customer_id), getSettings()]);
  // An answer to "which order?" (or photos for a claim) is worked as the original message plus the order.
  const message = req.answer ? `${req.answer.original}\n(About order #${req.answer.value ?? "?"}: ${req.answer.text})` : req.message;
  const intent = intentOf(req.answer?.original ?? req.message);
  const mine = await customerOrders(customer.id);
  const order = mine.find((o) => req.answer?.value === String(o.id)) ?? (await pickOrder(customer.id, message, intent));
  const photos = req.attachments ?? [];
  const owner = SUPPORT_AGENTS[0];

  // One ticket per chat session while it's unsolved, like a real messaging integration.
  const [session] = await db.select().from(s.chatSessions).where(eq(s.chatSessions.session_id, req.session_id));
  const open = session && (await ticketExists(session.ticket_id)) ? await findTicket(session.ticket_id) : null;
  const live = open && open.status !== "solved" ? open : null;

  if (settings.playbooks.support && intent === "refund" && !order && !req.answer && liveOrders(mine).length > 1) {
    const res = askWhichOrder(req, mine);
    await recordRun(req, message, { ticket_id: null, intent: "refund", level: null, handled_by: null, status: "resolved", reply: res.reply, plan: ["Ask the customer which order, then work the request"], steps: [{ agent: "main", step: "Ask which order", tool: "ShopKart chat", result: "success", detail: `${res.ask!.choices.length} options shown (stand-in)` }] });
    return res;
  }
  // Where is my order: answered in the chat, no ticket (unless the chat already has an open one).
  if (settings.playbooks.support && intent === "track" && order && !live) {
    const reply = trackingReply(order);
    await recordRun(req, message, {
      ticket_id: null, intent: "order_tracking", level: "low", handled_by: "low", status: "resolved", reply, reason: "information request", plan: ["Look up the order", "Answer in the chat"],
      steps: [
        { agent: "low", step: "Check order", tool: "ShopKart", result: "success", detail: `#${order.id}: ${order.status} (stand-in)` },
        { agent: "main", step: "Answer", tool: "ShopKart chat", result: "success", detail: "Answered in the chat; no ticket needed" },
      ],
    });
    return { reply };
  }

  let ticket: Ticket;
  if (live) {
    ticket = live;
    await addComment(ticket.id, { body: message, public: true, author: customer.name, author_type: "customer", attachment_ids: photos });
  } else {
    const subject =
      intent === "payment" && order ? `Payment failed but ${rupees(order.amount)} debited – order #${order.id}`
      : intent === "payment" ? "Money debited, payment failed"
      : intent === "refund" && order ? `Damaged item, refund requested – order #${order.id}`
      : intent === "track" && order ? `Where is my order #${order.id}?`
      : message.length > 60 ? `${message.slice(0, 57)}…` : message;
    ticket = await createTicket({
      subject,
      ...(!photos.length && { comment: message }),
      requester_id: customer.id,
      via: "chat",
      assignee: BOT,
      status: "open",
      order_id: order?.id ?? null,
      type: intent === "track" || intent === "other" ? "question" : "incident",
      priority: intent === "payment" ? "critical" : intent === "refund" ? "medium" : "low",
      tags: [intent === "track" ? "wismo" : intent, "chat"],
    });
    if (photos.length) await addComment(ticket.id, { body: message, public: true, author: customer.name, author_type: "customer", attachment_ids: photos });
    await db
      .insert(s.chatSessions)
      .values({ session_id: req.session_id, ticket_id: ticket.id })
      .onConflictDoUpdate({ target: s.chatSessions.session_id, set: { ticket_id: ticket.id } });
  }

  await sleep(900 + Math.random() * 900); // let the typing indicator breathe

  /** Hands the ticket to the owner with a note and tells the customer a person will review it. Never claims an approval. */
  const toOwner = async (level: AgentLevel, why: string, reply: string, step: string, plan: string[], intentName: string) => {
    await addComment(ticket.id, { public: false, body: `Handed to ${owner} by the ResolveAI stand-in (the agent was unreachable): ${why}` });
    const tags = (await findTicket(ticket.id)).tags.filter((t) => t !== "awaiting-photos");
    await updateTicket(ticket.id, { assignee: owner, priority: level === "critical" ? "urgent" : LEVEL_PRIORITY[level], status: "open", level, handled_by: "human", escalated_by_ai: true, tags });
    await addComment(ticket.id, { public: true, body: reply });
    await recordRun(req, message, {
      ticket_id: ticket.id, intent: intentName, level, handled_by: "human", status: "escalated", reply, reason: why, plan,
      steps: [{ agent: "main", step, tool: "Zendesk", result: "escalated", detail: `#${ticket.id} assigned to ${owner}: ${why}` }],
    });
    return { reply, ticket_id: ticket.id };
  };

  if (!settings.playbooks.support) {
    return toOwner("medium", "the support playbook is off in the Control Room", `Thanks, ${customer.name.split(" ")[0]}. I've passed this to ${OWNER.first} from our team (ticket #${ticket.id}), who will reply here shortly.`, "Hand to team", ["Support playbook is off: hand to the owner"], intent);
  }

  // The auto-refund limit is a Control Room setting (₹1,000 unless someone changed it).
  const limit = await refundLimit();
  if (intent === "payment") {
    const facts = order
      ? `${rupees(order.amount)} captured from the customer's bank, but order #${order.id} never got a payment confirmation. Needs a manual reconcile.`
      : `No order on the account shows a failed payment. Recent orders: ${mine.slice(0, 5).map((o) => `#${o.id} ${rupees(o.amount)} (${o.status}, ${o.payment_status.replace(/_/g, " ")})`).join("; ") || "none"}.`;
    const reply = order
      ? `I can see ${rupees(order.amount)} left your bank for order #${order.id}, but the payment never reached us. I've passed this to ${OWNER.first} from our team as urgent with all the details (ticket #${ticket.id}); you'll hear back within 2 hours.`
      : `I'm sorry about this. I can't see a failed payment on your recent orders, so I've passed it to ${OWNER.first} from our payments team as urgent (ticket #${ticket.id}). They'll check it with you within 2 hours.`;
    return toOwner("critical", facts, reply, "Escalate to human", ["Check the payment with the gateway", "Reconcile or refund"], "payment_failed");
  }

  if (intent === "refund" && order) {
    const refundable = (order.status === "damaged" || order.status === "delivered") && (order.payment_status === "paid" || order.payment_status === "cod");
    const damage = /damag|broke|crack|defect|wrong/i.test(req.answer?.original ?? req.message);
    const photosNeeded = damage && (settings.requireDamagePhotos || order.amount > 1000);
    const onTicket = (await db.select({ id: s.attachments.id }).from(s.attachments).where(eq(s.attachments.ticket_id, ticket.id))).length;
    const first = customer.name.split(" ")[0];
    if (!refundable) {
      return toOwner("medium", `order #${order.id} is ${order.status}, payment ${order.payment_status.replace(/_/g, " ")}: not refundable automatically`, `Thanks, ${first}. ${OWNER.first} from our team will look at order #${order.id} personally (ticket #${ticket.id}) and get back to you here.`, "Hand to team", ["Check the order", "Decide on a refund"], "refund");
    }
    if (photosNeeded && !onTicket) {
      // Proof before money: ask for photos, refund nothing. The ticket waits on the customer.
      const reply = `Sorry about that, ${first}. Before I can sort out a refund I need to see the damage: please add 1–3 photos of the item and the shipping label with the button below.`;
      await addComment(ticket.id, { public: true, body: reply });
      await updateTicket(ticket.id, { status: "pending", level: order.amount > limit ? "high" : "medium", handled_by: order.amount > limit ? "high" : "medium", tags: [...new Set([...ticket.tags, "awaiting-photos"])] });
      await recordRun(req, message, {
        ticket_id: ticket.id, intent: "damaged_item", level: order.amount > limit ? "high" : "medium", handled_by: order.amount > limit ? "high" : "medium", status: "resolved", reply, plan: ["Ask for photos of the damage", "Check them, then refund"],
        steps: [{ agent: "main", step: "Ask for photos", tool: "ShopKart chat", result: "success", detail: `#${order.id}: ${settings.requireDamagePhotos ? "the Control Room asks for photos on every damage claim" : "POL-DMG asks for a photo above ₹1,000"}` }],
      });
      return {
        reply,
        ticket_id: ticket.id,
        ask: { kind: "photos", prompt: "Add photos of the damage", description: "1–3 photos: the damaged item and the shipping label. JPEG or PNG, up to 5 MB each.", choices: [], original: req.answer?.original ?? req.message, photos: { min: 1, max: 3, order_id: order.id, hint: "photo needed" } },
      };
    }
    if (photosNeeded) {
      return toOwner(order.amount > limit ? "high" : "medium", `${onTicket} photo${onTicket === 1 ? "" : "s"} on the ticket; the stand-in can't check photos, so a person decides on the ${rupees(order.amount)} refund for order #${order.id}`, `Thanks for the photos, ${first}. ${OWNER.first} from our team will check them and get back to you about your refund here (ticket #${ticket.id}).`, "Hand to team", ["Check the photos", "Refund if they show the damage"], "damaged_item");
    }
    if (settings.autonomy === "suggest") {
      return toOwner("high", `autonomy is Suggest only: a person approves every refund (${rupees(order.amount)}, order #${order.id})`, `Thanks, ${first}. A teammate will review your refund for order #${order.id} personally (ticket #${ticket.id}) and get back to you here.`, "Hand to team", ["Review the refund", "Refund from ShopKart if it's fine"], "refund");
    }
    if (order.amount <= limit) {
      await refundOrder(order.id);
      await addComment(ticket.id, {
        public: false,
        body: `Policy check passed: delivered order, ${rupees(order.amount)} is within the ${rupees(limit)} auto-refund limit. Refund started to the original payment method. (ResolveAI stand-in)`,
      });
      const reply = `Sorry order #${order.id} (${itemsText(order)}) arrived damaged. I've started a refund of ${rupees(order.amount)} to your original payment method. It should reach you in 3–5 working days. No need to send anything back.`;
      await addComment(ticket.id, { public: true, body: reply });
      await updateTicket(ticket.id, { status: "solved", level: "medium", handled_by: "medium" });
      await recordRun(req, message, {
        ticket_id: ticket.id, intent: damage ? "damaged_item" : "refund", level: "medium", handled_by: "medium", status: "resolved", reply, reason: `refund of ${rupees(order.amount)} is within the auto-refund limit`, plan: ["Check the order", "Refund within the limit"],
        steps: [
          { agent: "medium", step: "Check order", tool: "ShopKart", result: "success", detail: `#${order.id}: ${order.status}, ${order.payment_status}, ${rupees(order.amount)}` },
          { agent: "medium", step: "Refund", tool: "Paytm", result: "success", detail: `${rupees(order.amount)} refunded for #${order.id}` },
        ],
      });
      return { reply, ticket_id: ticket.id };
    }
    // Above the limit: a person decides. The stand-in can't queue an approval, so it says a person will review it.
    return toOwner("high", `refund of ${rupees(order.amount)} for order #${order.id} is above the ${rupees(limit)} auto-refund limit; please review and refund from ShopKart if it's justified`, `Thanks, ${first}. As the refund is ${rupees(order.amount)}, a teammate will review it personally (ticket #${ticket.id}) and get back to you here.`, "Hand to team", ["Review the refund above the limit", "Refund if justified"], damage ? "damaged_item" : "refund");
  }

  let reply: string;
  if (intent === "track" && order) {
    reply = trackingReply(order);
    await addComment(ticket.id, { public: true, body: reply });
    await updateTicket(ticket.id, { status: "solved", level: "low", handled_by: "low" });
    await recordRun(req, message, { ticket_id: ticket.id, intent: "order_tracking", level: "low", handled_by: "low", status: "resolved", reply, reason: "information request", plan: ["Look up the order", "Answer"], steps: [{ agent: "low", step: "Check order", tool: "ShopKart", result: "success", detail: `#${order.id}: ${order.status}` }] });
    return { reply, ticket_id: ticket.id };
  }
  reply = `Thanks, ${customer.name.split(" ")[0]}. I've noted this as ticket #${ticket.id}. Could you share the order number so I can look into it?`;
  await addComment(ticket.id, { public: true, body: reply });
  await updateTicket(ticket.id, { status: "pending", level: "low", handled_by: "low" });
  await recordRun(req, message, { ticket_id: ticket.id, intent: "other", level: "low", handled_by: "low", status: "resolved", reply, reason: "needs the order number", plan: ["Ask for the order number"], steps: [{ agent: "low", step: "Ask for details", tool: "ShopKart chat", result: "success", detail: "Asked for the order number" }] });
  return { reply, ticket_id: ticket.id };
}

/**
 * A person owns this chat (they took it over in the Control Room, or Aria escalated it to them): the message goes
 * onto their ticket and Aria doesn't act. While they're talking with the customer she says nothing; otherwise the
 * customer hears who has it.
 */
async function toPerson(chat: ChatRef, { ticket, agent }: { ticket: { id: number; status: string }; agent: string }, name: string, message: string, photos: number[] = []): Promise<ChatResponse> {
  await addComment(ticket.id, { body: message, public: true, author: name, author_type: "customer", attachment_ids: photos });
  if (ticket.status === "pending" || ticket.status === "new") await updateTicket(ticket.id, { status: "open" });
  if (await personActive(chat.session_id)) return { reply: "", ticket_id: ticket.id };
  const reply = `Thanks, I've added this to your ticket #${ticket.id}. ${agent} from our team is on it and will reply here.`;
  await addComment(ticket.id, { body: reply, public: true });
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
  // The sales playbook is off in the Control Room: the CRM records exist, nobody scores or follows up automatically.
  if (!(await getSettings()).playbooks.sales) {
    const deal = await createDeal({ name: `${b.business_name} – ${need}`, amount: budget, contact_id: contact.id, next_step: `${OWNER.first} to qualify` });
    await logActivity(deal.id, { type: "note", author: BOT, ai: true, body: `New lead from the business enquiry form. Need: ${need.toLowerCase()}. Budget ${rupees(budget)}. Wants to start: ${b.start_when || "not given"}. The sales playbook is off in the ResolveAI Control Room, so it wasn't scored: needs ${OWNER.first}.` });
    return { ok: true, message: `Thanks! ${OWNER.first} from our team will contact you shortly.`, deal_id: deal.id };
  }
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
      const message = b.message.trim();
      const chat: ChatRef = { session_id: b.session_id, customer_id: b.customer_id, channel_id: "shopkart" };
      const [customer, person] = await Promise.all([findCustomer(b.customer_id), personOnChat(b.session_id)]);
      // Every line is stored, so the Control Room's Chats inbox and a reloaded widget see the same conversation.
      const mine = await record(chat, { sender: "customer", author: customer.name, body: message, answer: b.answer ?? null, ticket_id: person?.ticket.id ?? null });
      // Photos uploaded just before (POST /shop/chat/attachments) belong to this line; ids from anyone else are dropped.
      const photos = await linkToChatMessage(b.attachments, chat, mine.id);
      if (person) return ok(await toPerson(chat, person, customer.name, message, photos));

      // ShopKart is a ResolveAI channel: its chats go to the agent's intake with the channel token.
      let res: ChatResponse;
      const forwarded = await forward("/intake", { ...b, message, attachments: photos }, { token: shopkartChannelToken() });
      if (forwarded) {
        if (!forwarded.ok) return forwarded;
        res = (await forwarded.json()) as ChatResponse;
      } else res = await simulateChat({ ...b, message, attachments: photos });

      if (res.ticket_id) {
        await linkTicket(chat, res.ticket_id);
        await db.update(s.chatMessages).set({ ticket_id: res.ticket_id }).where(eq(s.chatMessages.id, mine.id));
      }
      await recordAria(chat, res.reply, { ticket_id: res.ticket_id ?? null, ask: res.ask ?? null });
      return ok(res);
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
