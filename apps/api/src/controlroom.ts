/**
 * The Control Room's endpoints (/control-room/*; the dashboard calls them as /api/control-room/*).
 * Everything is built from the live Postgres records: Zendesk tickets and comments, ResolveAI runs,
 * steps and approvals, CRM deals and activities, Sarvam calls, channels, connectors, settings and the
 * team board. Shapes are `@ph/shared/controlroom`. Nothing here is invented: an empty database gives
 * empty lists and zero stats.
 *
 * Each GET is polled every few seconds and the database is remote, so every handler runs a couple of
 * batched rounds of queries (Promise.all, inArray), never one query per row.
 */
import type * as CR from "@ph/shared/controlroom";
import { BOT, DEAL_STAGES, OWNER, rupees, type DealStage, type TicketChannel } from "@ph/shared";
import { and, count, DEFAULT_SETTINGS, desc, eq, gte, inArray, isNotNull, isNull, schema as s, sql } from "@ph/db";
import { updateContact, updateDeal } from "./crm.ts";
import { db } from "./db.ts";
import { bad, body, handle, intParam, notFound, ok, oneOf } from "./http.ts";
import { decideApproval, listConnectors, newToken, setChannelToken } from "./resolveai.ts";
import { updateTicket } from "./zendesk.ts";

type TicketRow = typeof s.tickets.$inferSelect;
type CommentRow = typeof s.ticketComments.$inferSelect;
type RunRow = typeof s.agentRuns.$inferSelect & { steps: (typeof s.agentSteps.$inferSelect)[] };
type ChannelRow = typeof s.channels.$inferSelect;

/* ───── Time ───── */

const TZ = "Asia/Kolkata";
const DAY = 86_400_000;
const DAYS = 14;
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD in IST
/** Midnight today, IST. "Today" counts on the Channels and Connectors pages start here. */
const startOfToday = () => new Date(`${dayKey(new Date())}T00:00:00+05:30`);
/** The last 14 IST days, oldest first. */
const lastDays = () => Array.from({ length: DAYS }, (_, i) => dayKey(new Date(Date.now() - (DAYS - 1 - i) * DAY)));
const iso = (d: Date) => d.toISOString();

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return Math.round(v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2);
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
/** % change of `now` over `before`; 0 when there is nothing to compare with. */
const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : 0);
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);

/** "38s", "2m 10s", "1h 5m"; "—" when there is nothing to average. */
function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  const t = Math.round(seconds);
  if (t < 60) return `${t}s`;
  if (t < 3600) return `${Math.floor(t / 60)}m${t % 60 ? ` ${t % 60}s` : ""}`;
  const m = Math.floor((t % 3600) / 60);
  return `${Math.floor(t / 3600)}h${m ? ` ${m}m` : ""}`;
}

/** "+91 90000 10101" → "+91 90•••• 0101". Falls back to the email when there is no usable phone. */
function maskedContact(phone: string, email: string): string {
  const compact = phone.replace(/[^\d+]/g, "");
  const cc = compact.startsWith("+91") ? "+91" : compact.startsWith("+") ? compact.slice(0, 3) : "";
  const national = compact.slice(cc.length).replace(/\D/g, "");
  if (national.length < 6) return email;
  return `${cc ? `${cc} ` : ""}${national.slice(0, 2)}•••• ${national.slice(-4)}`;
}

/* ───── Settings ───── */

const AUTONOMY = ["suggest", "approval", "autonomous"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
let settingsCache: { at: number; value: CR.Settings } | null = null;

export async function getSettings(): Promise<CR.Settings> {
  if (settingsCache && Date.now() - settingsCache.at < 5_000) return settingsCache.value;
  const [row] = await db.select().from(s.settings).where(eq(s.settings.id, "default"));
  // Stored settings over the defaults, so a field added later still has a value.
  const value: CR.Settings = { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
  settingsCache = { at: Date.now(), value };
  return value;
}

/** The auto-refund limit (₹) from the Control Room settings. The stand-in agent and approvals use it. */
export const refundLimit = async () => (await getSettings()).refundLimit;

function validSettings(b: CR.Settings): CR.Settings {
  const str = (v: unknown, field: string, max = 60) => {
    if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw bad(`${field} must be a non-empty text up to ${max} characters`);
    return v.trim();
  };
  const bool = (v: unknown, field: string) => {
    if (typeof v !== "boolean") throw bad(`${field} must be true or false`);
    return v;
  };
  const obj = (v: unknown, field: string) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw bad(`${field} must be an object`);
    return v as Record<string, unknown>;
  };
  const time = (v: unknown, field: string) => {
    if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(`${field} must be a time like 09:00`);
    return v;
  };
  if (typeof b.refundLimit !== "number" || !Number.isFinite(b.refundLimit) || b.refundLimit < 0) throw bad("refundLimit must be a number ≥ 0 (₹)");
  if (typeof b.avatarColor !== "string" || !/^#[0-9a-f]{6}$/i.test(b.avatarColor)) throw bad("avatarColor must be a hex colour like #0F9D8A");
  const playbooks = obj(b.playbooks, "playbooks");
  const escalation = obj(b.escalation, "escalation");
  const hours = obj(b.hours, "hours");
  if (!Array.isArray(b.languages) || !b.languages.length) throw bad("languages must list at least one language");
  if (!Array.isArray(hours.days) || hours.days.some((d) => !WEEKDAYS.includes(d as string))) throw bad(`hours.days must be a list of ${WEEKDAYS.join(", ")}`);
  return {
    agentName: str(b.agentName, "agentName", 40),
    avatarColor: b.avatarColor,
    tone: str(b.tone, "tone"),
    playbooks: { support: bool(playbooks.support, "playbooks.support"), sales: bool(playbooks.sales, "playbooks.sales") },
    autonomy: oneOf(b.autonomy, AUTONOMY, "autonomy"),
    refundLimit: b.refundLimit,
    escalation: Object.fromEntries(Object.entries(escalation).map(([k, v]) => [k, bool(v, `escalation.${k}`)])),
    languages: [...new Set(b.languages.map((l, i) => str(l, `languages[${i}]`, 30)))],
    hours: {
      days: WEEKDAYS.filter((d) => (hours.days as string[]).includes(d)),
      from: time(hours.from, "hours.from"),
      to: time(hours.to, "hours.to"),
      afterHours: oneOf(hours.afterHours, AUTONOMY, "hours.afterHours"),
    },
  };
}

async function saveSettings(b: Partial<CR.Settings>): Promise<CR.Settings> {
  // A partial body is merged onto the current settings, then the whole thing is checked.
  const current = await getSettings();
  const value = validSettings({ ...current, ...b, hours: { ...current.hours, ...(b.hours ?? {}) } } as CR.Settings);
  await db
    .insert(s.settings)
    .values({ id: "default", value, updated_at: new Date() })
    .onConflictDoUpdate({ target: s.settings.id, set: { value, updated_at: new Date() } });
  settingsCache = { at: Date.now(), value };
  return value;
}

/* ───── Tickets ───── */

const VIA: Record<TicketChannel, CR.ChannelId> = { chat: "chat", email: "email", web: "webchat", api: "api" };
/** Steps that mark the agent's first answer to the customer on a run. */
const REPLY_STEPS = ["Acknowledge", "Answer", "Ask which order", "Pass to owner", "Escalate to human", "Status update", "Out of scope", "Hand to team", "Hand over"];

const isPersonReply = (c: CommentRow) => c.public && c.author_type === "agent" && c.author !== BOT;

/** Handed to a person: the AI escalated it, a person owns or answered it, or the main agent routed it to a human. */
function withPerson(t: TicketRow, comments: CommentRow[]): boolean {
  return t.escalated_by_ai || t.handled_by === "human" || (!!t.assignee && t.assignee !== BOT) || comments.some(isPersonReply);
}

function crStatus(t: TicketRow, latest: RunRow | undefined): CR.Status {
  if (t.status === "solved") return "solved";
  if (latest?.status === "triaging" || latest?.status === "working") return "in_progress";
  if (latest?.status === "waiting_approval") return "waiting";
  return t.status === "pending" ? "waiting" : "open";
}

function toStep(x: RunRow["steps"][number]): CR.Step {
  return { step: x.step, tool: x.tool, result: x.result, time: iso(x.created_at), detail: x.detail };
}

/** A ticket as the Control Room shows it, plus the facts /stats needs. */
interface TicketView {
  ticket: CR.Ticket;
  created: Date;
  person: boolean;
  escalated: boolean;
  /** Seconds from the request arriving to the last public AI or agent reply, for solved tickets (the reply that solved it) */
  solvedIn: number | null;
}

/**
 * The order a ticket is about: its order_id, else the one its subject names ("… – order #1023"; the agent
 * writes subjects like that but doesn't set order_id). A subject's order counts only if it is the requester's.
 */
const orderIdOf = (t: TicketRow) => t.order_id ?? (Number(t.subject.match(/order #(\d+)/i)?.[1]) || null);
function ticketOrder<O extends { customer_id: number }>(t: TicketRow, orders: Map<number, O>): O | undefined {
  const id = orderIdOf(t);
  const o = id ? orders.get(id) : undefined;
  return o && (t.order_id === id || o.customer_id === t.requester_id) ? o : undefined;
}

async function loadTickets(ids?: number[]): Promise<TicketView[]> {
  const [rows, channels] = await Promise.all([
    db
      .select({ ticket: s.tickets, requester: s.zdUsers })
      .from(s.tickets)
      .innerJoin(s.zdUsers, eq(s.tickets.requester_id, s.zdUsers.id))
      .where(ids ? inArray(s.tickets.id, ids) : undefined)
      .orderBy(desc(s.tickets.created_at), desc(s.tickets.id)),
    db.select({ id: s.channels.id, kind: s.channels.kind }).from(s.channels),
  ]);
  if (!rows.length) return [];
  const ticketIds = rows.map((r) => r.ticket.id);
  const orderIds = [...new Set(rows.flatMap((r) => { const o = orderIdOf(r.ticket); return o ? [o] : []; }))];
  const requesterIds = [...new Set(rows.map((r) => r.requester.id))];
  const [comments, runs, customers, orders, approvals] = await Promise.all([
    db.select().from(s.ticketComments).where(inArray(s.ticketComments.ticket_id, ticketIds)),
    db.query.agentRuns.findMany({ where: inArray(s.agentRuns.ticket_id, ticketIds), with: { steps: true } }),
    db.select({ id: s.customers.id, city: s.customers.city }).from(s.customers).where(inArray(s.customers.id, requesterIds)),
    orderIds.length ? db.select({ id: s.orders.id, customer_id: s.orders.customer_id, amount: s.orders.amount }).from(s.orders).where(inArray(s.orders.id, orderIds)) : [],
    db
      .select({ ticket_id: s.approvals.ticket_id, amount: s.approvals.amount })
      .from(s.approvals)
      .where(and(inArray(s.approvals.ticket_id, ticketIds), eq(s.approvals.status, "pending"))),
  ]);

  const kindOf = new Map(channels.map((c) => [c.id, c.kind as CR.ChannelId]));
  const cityOf = new Map(customers.map((c) => [c.id, c.city]));
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const pendingOf = new Map(approvals.map((a) => [a.ticket_id, a.amount]));
  const commentsOf = Map.groupBy(
    [...comments].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id),
    (c) => c.ticket_id,
  );
  const runsOf = Map.groupBy(
    [...runs].sort((a, b) => a.id - b.id),
    (r) => r.ticket_id!,
  );

  return rows.map(({ ticket: t, requester }) => {
    const mine = commentsOf.get(t.id) ?? [];
    const myRuns = runsOf.get(t.id) ?? [];
    const latest = myRuns.at(-1);
    const pub = mine.filter((c) => c.public);
    const person = withPerson(t, mine);
    const status = crStatus(t, latest);
    const lastNote = mine.filter((c) => !c.public).at(-1);
    const lastReply = pub.filter((c) => c.author_type !== "customer").at(-1);
    const ticket: CR.Ticket = {
      id: String(t.id),
      customer: { name: requester.name, contact: maskedContact(requester.phone, requester.email), city: cityOf.get(requester.id) ?? "" },
      issue: t.subject,
      channel: (latest && (kindOf.get(latest.channel_id) ?? (latest.channel_id === "shopkart" ? "chat" : undefined))) || VIA[t.via] || "api",
      level: t.level ?? latest?.level ?? myRuns.findLast((r) => r.level)?.level ?? "low",
      status,
      solvedBy: status === "solved" ? (person ? "human" : "ai") : null,
      helpdesk: "zendesk",
      helpdeskId: `#${t.id}`,
      amount: ticketOrder(t, orderOf)?.amount ?? pendingOf.get(t.id) ?? null,
      createdAt: iso(t.created_at),
      conversation: pub.map((c) => ({
        from: c.author_type === "customer" ? "customer" : c.author_type === "bot" || c.author === BOT ? "ai" : "agent",
        time: iso(c.created_at),
        text: c.body,
      })),
      steps: myRuns
        .flatMap((r) => r.steps)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id)
        .map(toStep),
      // A ticket with a person and nothing written yet says who has it (the business has one person: the owner).
      // The last thing the customer was told, by the AI or a person (every run's reply is posted on the ticket). A run
      // that finished earlier can't stand in for it: a status check, then an approval, update different runs.
      result: lastReply?.body || lastNote?.body || (person && status !== "solved" ? `With ${t.assignee && t.assignee !== BOT ? t.assignee : OWNER.name}` : ""),
    };
    return {
      ticket,
      created: t.created_at,
      person,
      escalated: t.escalated_by_ai || t.handled_by === "human",
      // From when the request reached ResolveAI (its first run; the ticket itself is opened after triage), else
      // from the ticket opening, to the reply that solved it. Not the first reply: that is an instant "I'm on it".
      solvedIn: status === "solved" && lastReply ? Math.max(0, (lastReply.created_at.getTime() - Math.min(t.created_at.getTime(), myRuns[0]?.created_at.getTime() ?? Infinity)) / 1000) : null,
    };
  });
}

async function oneTicket(id: number): Promise<CR.Ticket> {
  const [view] = await loadTickets([id]);
  if (!view) throw notFound(`Ticket #${id}`);
  return view.ticket;
}

const STATUS_TO_ZENDESK = { open: "open", in_progress: "open", waiting: "pending", solved: "solved" } as const;

/* ───── Leads ───── */

const STAGES = DEAL_STAGES;
const stageLabel = (id: DealStage) => STAGES.find((x) => x.id === id)?.label ?? id;
/**
 * The lead score shown in the Control Room. Deals carry a hot / warm / cold label (set by the sales or leads
 * agent, or a call); this turns it into a number. The stage probability isn't used: it says how far the deal
 * got, not how good the lead is.
 */
const SCORE = { hot: 90, warm: 60, cold: 30 } as const;
const ACTIVITY_STEP: Record<string, string> = { note: "Note", email: "Email", meeting: "Meeting booked", call: "Call", stage_change: "Stage change", quote: "Quote" };
/** Campaign channels → where the lead came in. Ad campaigns collect responses through lead forms. */
const CAMPAIGN_TO_CHANNEL: Record<string, CR.ChannelId> = { meta_ads: "form", google_ads: "form", whatsapp: "whatsapp", email: "email" };
const isOpenStage = (stage: DealStage) => stage !== "closed_won" && stage !== "closed_lost";

interface LeadView {
  lead: CR.Lead;
  created: Date;
  open: boolean;
}

async function loadLeads(dealId?: number): Promise<LeadView[]> {
  const where = dealId === undefined ? undefined : eq(s.deals.id, dealId);
  const [rows, activities, calls, responses] = await Promise.all([
    db
      .select({ deal: s.deals, contact: s.contacts })
      .from(s.deals)
      .innerJoin(s.contacts, eq(s.deals.contact_id, s.contacts.id))
      .where(where)
      .orderBy(desc(s.deals.created_at), desc(s.deals.id)),
    db.select().from(s.activities).where(dealId === undefined ? undefined : eq(s.activities.deal_id, dealId)),
    db
      .select({ id: s.calls.id, contact_id: s.calls.contact_id, deal_id: s.calls.deal_id, status: s.calls.status, outcome: s.calls.outcome, summary: s.calls.summary, error: s.calls.error, created_at: s.calls.created_at, ended_at: s.calls.ended_at })
      .from(s.calls),
    db
      .select({ contact_id: s.campaignResponses.contact_id, channel: s.campaigns.channel })
      .from(s.campaignResponses)
      .innerJoin(s.campaigns, eq(s.campaignResponses.campaign_id, s.campaigns.id))
      .where(isNotNull(s.campaignResponses.contact_id)),
  ]);
  const activitiesOf = Map.groupBy(activities, (a) => a.deal_id);
  const campaignOf = new Map(responses.map((r) => [r.contact_id!, r.channel]));

  return rows.map(({ deal: d, contact: c }) => {
    const myCalls = calls.filter((x) => x.deal_id === d.id || (x.deal_id === null && x.contact_id === c.id));
    // Where the lead came in (the contact's source). A form or campaign lead that Aria later called stays a form or
    // campaign lead; its calls show in the steps. Only a lead with no other origin counts as voice because of a call.
    const byCall = myCalls.length > 0 || calls.some((x) => x.contact_id === c.id);
    const channel: CR.Lead["channel"] =
      c.source === "Voice call"
        ? "voice"
        : c.source === "Business enquiry form"
          ? "form"
          : c.source === "Campaign"
            ? (CAMPAIGN_TO_CHANNEL[campaignOf.get(c.id) ?? ""] ?? "form")
            : c.source === "Chat"
              ? "chat"
              : byCall
                ? "voice"
                : "manual";
    const steps: (CR.Step & { at: number })[] = [
      ...(activitiesOf.get(d.id) ?? []).map((a) => ({
        step: ACTIVITY_STEP[a.type] ?? a.type,
        tool: "HubSpot",
        result: "success" as const,
        time: iso(a.created_at),
        detail: a.ai ? a.body : `${a.author}: ${a.body}`,
        at: a.created_at.getTime(),
      })),
      ...myCalls.map((x) => ({
        step: "Voice call",
        tool: "Sarvam",
        // A call that never connected is shown as blocked rather than a success.
        result: (x.status === "failed" || x.status === "no_answer" ? "blocked" : "success") as CR.StepResult,
        time: iso(x.created_at),
        detail: x.summary || x.error || [x.status.replace(/_/g, " "), x.outcome?.replace(/_/g, " ")].filter(Boolean).join(" · "),
        at: x.created_at.getTime(),
      })),
    ];
    steps.sort((a, b) => a.at - b.at);
    return {
      lead: {
        id: String(d.id),
        name: c.name,
        company: c.company,
        need: d.name,
        channel,
        score: SCORE[d.score],
        value: d.amount,
        stage: stageLabel(d.stage),
        hot: d.score === "hot",
        createdAt: iso(d.created_at),
        steps: steps.map(({ at: _, ...x }) => x),
      },
      created: d.created_at,
      open: isOpenStage(d.stage),
    };
  });
}

async function oneLead(id: number): Promise<CR.Lead> {
  const [view] = await loadLeads(id);
  if (!view) throw notFound(`Lead ${id}`);
  return view.lead;
}

function stageId(v: string): DealStage {
  const x = v.trim().toLowerCase();
  const hit = STAGES.find((st) => st.id === x || st.label.toLowerCase() === x);
  if (!hit) throw bad(`stage must be one of: ${STAGES.map((st) => st.label).join(", ")}`);
  return hit.id;
}

/* ───── Approvals ───── */

/** "AP-12" or "12" → 12 */
const approvalId = (v: string | undefined) => intParam((v ?? "").replace(/^AP-/i, ""), "Approval id");

/**
 * Confidence of the AI's reading behind an approval: the main agent's triage confidence, recorded in the
 * run's "Triage" step ("…, confidence 90%: …"). Approvals store no confidence of their own; with no triage
 * step to read it from, 1 is used.
 */
function triageConfidence(detail: string | undefined): number {
  const m = detail?.match(/confidence (\d{1,3})%/);
  return m ? Math.min(1, Number(m[1]) / 100) : 1;
}

async function loadApprovals(): Promise<CR.Approvals> {
  const [rows, limit] = await Promise.all([db.select().from(s.approvals).orderBy(desc(s.approvals.created_at), desc(s.approvals.id)).limit(100), refundLimit()]);
  if (!rows.length) return { pending: [], history: [] };
  const ticketIds = [...new Set(rows.map((a) => a.ticket_id))];
  const orderIds = [...new Set(rows.map((a) => a.order_id))];
  const runIds = [...new Set(rows.map((a) => a.run_id))];
  const [requesters, orders, triage, perCustomer] = await Promise.all([
    db.select({ id: s.tickets.id, name: s.zdUsers.name }).from(s.tickets).innerJoin(s.zdUsers, eq(s.tickets.requester_id, s.zdUsers.id)).where(inArray(s.tickets.id, ticketIds)),
    db.select().from(s.orders).where(inArray(s.orders.id, orderIds)),
    db.select({ run_id: s.agentSteps.run_id, detail: s.agentSteps.detail }).from(s.agentSteps).where(and(inArray(s.agentSteps.run_id, runIds), eq(s.agentSteps.step, "Triage"))),
    db.select({ customer_id: s.orders.customer_id, n: count() }).from(s.orders).groupBy(s.orders.customer_id),
  ]);
  const nameOf = new Map(requesters.map((r) => [r.id, r.name]));
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const triageOf = new Map(triage.map((t) => [t.run_id, t.detail]));
  const countOf = new Map(perCustomer.map((c) => [c.customer_id, c.n]));

  const toApproval = (a: (typeof rows)[number]): CR.Approval => {
    const o = orderOf.get(a.order_id);
    const others = o ? (countOf.get(o.customer_id) ?? 1) - 1 : null;
    return {
      id: `AP-${a.id}`,
      ref: String(a.ticket_id),
      kind: "ticket",
      reason: a.reason || `Refund above the ${rupees(limit)} auto-refund limit`,
      tone: limit > 0 && a.amount >= 10 * limit ? "red" : "amber",
      customer: nameOf.get(a.ticket_id) ?? "Customer",
      amount: a.amount,
      summary: a.summary,
      suggestion: a.suggestion,
      evidence: [
        o ? `Order #${o.id}: ${o.status}, ${rupees(o.amount)}` : `Order #${a.order_id} not found`,
        o ? `Payment: ${o.payment_status.replace(/_/g, " ")}` : null,
        others === null ? null : others === 0 ? "First order with ShopKart" : `${others} other order${others === 1 ? "" : "s"} with ShopKart`,
        `Auto-refund limit: ${rupees(limit)}`,
      ].filter((x): x is string => !!x),
      confidence: triageConfidence(triageOf.get(a.run_id)),
      createdAt: iso(a.created_at),
    };
  };

  return {
    pending: rows.filter((a) => a.status === "pending").map(toApproval),
    history: rows
      .filter((a) => a.status !== "pending")
      .sort((a, b) => (b.decided_at?.getTime() ?? 0) - (a.decided_at?.getTime() ?? 0))
      .map((a) => ({
        ...toApproval(a),
        decision: a.status as CR.Decision,
        by: a.decided_by ?? "",
        ...(a.note && { note: a.note }),
        decidedAt: iso(a.decided_at ?? a.created_at),
      })),
  };
}

/* ───── Conversations (answered in the chat, no ticket) ───── */

interface ConversationView {
  conversation: CR.Conversation;
  created: Date;
  /** Seconds from the message to Aria's answer */
  answeredIn: number;
  /** A new question that was triaged (not a status check or an out-of-scope message): counts as a query */
  query: boolean;
}

/** The main agent's reading in a run's "Triage" step: "new request, order_tracking, confidence 90%: <summary>" */
const triageSummary = (detail: string | undefined) => detail?.replace(/^[^:]*confidence \d+%:\s*/, "") ?? "";

async function loadConversations(): Promise<ConversationView[]> {
  const [runs, channels] = await Promise.all([
    db.query.agentRuns.findMany({
      where: and(isNull(s.agentRuns.ticket_id), isNotNull(s.agentRuns.reply)),
      with: { steps: true },
      orderBy: desc(s.agentRuns.id),
      limit: 300,
    }),
    db.select({ id: s.channels.id, kind: s.channels.kind }).from(s.channels),
  ]);
  if (!runs.length) return [];
  const customerIds = [...new Set(runs.map((r) => r.customer_id))];
  const customers = await db.select().from(s.customers).where(inArray(s.customers.id, customerIds));
  const customerOf = new Map(customers.map((c) => [c.id, c]));
  const kindOf = new Map(channels.map((c) => [c.id, c.kind as CR.ChannelId]));
  return runs.map((r) => {
    const who = customerOf.get(r.customer_id);
    const steps = [...r.steps].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id);
    const answeredAt = steps.findLast((x) => REPLY_STEPS.includes(x.step))?.created_at ?? r.updated_at;
    return {
      conversation: {
        id: `C-${r.id}`,
        customer: who ? { name: who.name, contact: maskedContact(who.phone, who.email), city: who.city } : { name: `Customer ${r.customer_id}`, contact: "", city: "" },
        channel: kindOf.get(r.channel_id) ?? "chat",
        issue: r.message.length > 120 ? `${r.message.slice(0, 117)}…` : r.message,
        summary: triageSummary(steps.find((x) => x.step === "Triage")?.detail),
        level: r.level,
        kind: r.kind,
        createdAt: iso(r.created_at),
        answeredAt: iso(answeredAt),
        conversation: [
          { from: "customer", time: iso(r.created_at), text: r.message },
          { from: "ai", time: iso(answeredAt), text: r.reply! },
        ],
        steps: steps.map(toStep),
        sessionId: r.session_id,
        result: r.reply!,
      },
      created: r.created_at,
      answeredIn: Math.max(0, (answeredAt.getTime() - r.created_at.getTime()) / 1000),
      query: r.kind === "request" && r.intent !== "out_of_scope" && !!r.level,
    };
  });
}

/* ───── Stats ───── */

async function computeStats(): Promise<CR.Stats> {
  const [tickets, leads, conversations] = await Promise.all([loadTickets(), loadLeads(), loadConversations()]);
  // Questions Aria answered in the chat without a ticket are queries too, handled and solved by the AI.
  const answered = conversations.filter((c) => c.query);
  const days = lastDays();
  const index = new Map(days.map((d, i) => [d, i]));
  const perDay = <T>(xs: T[], dateOf: (x: T) => Date, value: (xs: T[]) => number) => {
    const buckets = days.map(() => [] as T[]);
    for (const x of xs) {
      const i = index.get(dayKey(dateOf(x)));
      if (i !== undefined) buckets[i]!.push(x);
    }
    return buckets.map(value);
  };
  /** The two halves of a 14-day series: [previous 7 days, last 7 days]. */
  const halves = (xs: number[]): [number[], number[]] => [xs.slice(0, 7), xs.slice(7)];

  const aiTickets = perDay(tickets, (t) => t.created, (xs) => xs.filter((t) => !t.person).length);
  const aiChats = perDay(answered, (c) => c.created, (xs) => xs.length);
  const ai = aiTickets.map((n, i) => n + aiChats[i]!);
  const human = perDay(tickets, (t) => t.created, (xs) => xs.filter((t) => t.person).length);
  const escalatedDaily = perDay(tickets, (t) => t.created, (xs) => xs.filter((t) => t.escalated).length);
  // Solve time: a solved ticket from the request to the reply that solved it; a chat answer from message to answer.
  const solved = [
    ...tickets.flatMap((t) => (t.ticket.status === "solved" && t.solvedIn !== null ? [{ created: t.created, seconds: t.solvedIn }] : [])),
    ...answered.map((c) => ({ created: c.created, seconds: c.answeredIn })),
  ];
  const solveDaily = perDay(solved, (t) => t.created, (xs) => median(xs.map((t) => t.seconds)));
  const hotDaily = perDay(leads, (l) => l.created, (xs) => xs.filter((l) => l.lead.hot).length);

  const total = days.map((_, i) => ai[i]! + human[i]!);
  const [prevTotal, nowTotal] = halves(total).map(sum) as [number, number];
  const [prevAi, nowAi] = halves(ai).map(sum) as [number, number];
  const since = (t: { created: Date }, d: number) => Date.now() - t.created.getTime() < d * DAY;
  // Solve time per half from the tickets themselves, not a median of daily medians.
  const solveIn = (from: number, to: number) => median(solved.filter((t) => since(t, to) && !since(t, from)).map((t) => t.seconds));

  const channelCounts = new Map<CR.ChannelId, number>();
  for (const c of [...tickets.map((t) => t.ticket.channel), ...answered.map((x) => x.conversation.channel), ...leads.flatMap((l) => (l.lead.channel === "manual" ? [] : [l.lead.channel]))]) {
    channelCounts.set(c, (channelCounts.get(c) ?? 0) + 1);
  }
  const LEVELS: CR.Level[] = ["low", "medium", "high", "critical"];

  return {
    daily: { ai, human },
    deltas: {
      queries: pct(nowTotal, prevTotal),
      // AI share of tickets, in percentage points: this week's rate minus last week's.
      aiRate: prevTotal && nowTotal ? Math.round(((nowAi / nowTotal - prevAi / prevTotal) * 100) * 10) / 10 : 0,
      escalated: pct(...(halves(escalatedDaily).map(sum).reverse() as [number, number])),
      solveTime: pct(solveIn(0, 7), solveIn(7, 14)),
      hotLeads: pct(...(halves(hotDaily).map(sum).reverse() as [number, number])),
    },
    escalated: { value: tickets.filter((t) => t.escalated && since(t, 30)).length, spark: escalatedDaily },
    solveTime: { seconds: median(solved.filter((t) => since(t, 30)).map((t) => t.seconds)), spark: solveDaily },
    hotLeads: { value: leads.filter((l) => l.lead.hot && l.open).length, spark: hotDaily },
    byChannel: [...channelCounts].map(([channel, n]) => ({ channel, count: n })).sort((a, b) => b.count - a.count),
    byLevel: LEVELS.map((level) => ({ level, count: tickets.filter((t) => t.ticket.level === level).length + answered.filter((c) => (c.conversation.level ?? "low") === level).length })),
  };
}

/* ───── Channels ───── */

const CHANNEL_INFO: Record<CR.ChannelId, { desc: string; handle?: string }> = {
  chat: { desc: "Customers chat with Aria inside the ShopKart app", handle: "ShopKart chat widget" },
  voice: { desc: "Aria calls leads on the phone and logs what they need", handle: "Sarvam · Aria · Sales Caller" },
  form: { desc: "Business enquiries from the ShopKart website go to the sales agent", handle: "ShopKart business enquiry form" },
  webchat: { desc: "A chat widget on your own website" },
  whatsapp: { desc: "WhatsApp Business messages from customers" },
  email: { desc: "Emails to your support inbox" },
  appchat: { desc: "Chat inside your mobile app" },
  api: { desc: "Any system that posts customer requests to ResolveAI" },
};
const TOKEN_HANDLE = "POST /intake with this channel's token";

/** Kinds that can be added as a real channel with its own token. */
const CHANNEL_CATALOG: CR.ChannelOffer[] = (["webchat", "whatsapp", "email", "api"] as const).map((id) => ({
  id,
  name: { webchat: "Website chat", whatsapp: "WhatsApp", email: "Email", api: "API" }[id],
  desc: CHANNEL_INFO[id].desc,
}));

function channelView(c: ChannelRow, messagesToday: number, avgSeconds: number | null): CR.ChannelConnection {
  const kind = c.kind as CR.ChannelId;
  return {
    id: c.id,
    kind,
    name: c.name,
    desc: CHANNEL_INFO[kind]?.desc ?? "",
    handle: CHANNEL_INFO[kind]?.handle ?? TOKEN_HANDLE,
    connected: !!c.token_hash || kind === "voice" || kind === "form",
    enabled: c.enabled,
    messagesToday,
    avgResponse: duration(avgSeconds),
  };
}

async function loadChannels(): Promise<CR.ChannelConnection[]> {
  const today = startOfToday();
  const week = new Date(Date.now() - 7 * DAY);
  const formDeal = and(eq(s.contacts.source, "Business enquiry form"), gte(s.deals.created_at, week));
  const [channels, runs, firstReplies, callsToday, formDeals, formFirstNotes] = await Promise.all([
    db.select().from(s.channels).orderBy(s.channels.created_at, s.channels.id),
    db
      .select({ id: s.agentRuns.id, channel_id: s.agentRuns.channel_id, reply: s.agentRuns.reply, created_at: s.agentRuns.created_at, updated_at: s.agentRuns.updated_at })
      .from(s.agentRuns)
      .where(gte(s.agentRuns.created_at, week)),
    db
      .select({ run_id: s.agentSteps.run_id, at: sql<Date>`min(${s.agentSteps.created_at})`.mapWith(s.agentSteps.created_at) })
      .from(s.agentSteps)
      .innerJoin(s.agentRuns, eq(s.agentSteps.run_id, s.agentRuns.id))
      .where(and(gte(s.agentRuns.created_at, week), inArray(s.agentSteps.step, REPLY_STEPS)))
      .groupBy(s.agentSteps.run_id),
    db.select({ n: count() }).from(s.calls).where(gte(s.calls.created_at, today)),
    db.select({ id: s.deals.id, created_at: s.deals.created_at }).from(s.deals).innerJoin(s.contacts, eq(s.deals.contact_id, s.contacts.id)).where(formDeal),
    db
      .select({ deal_id: s.activities.deal_id, at: sql<Date>`min(${s.activities.created_at})`.mapWith(s.activities.created_at) })
      .from(s.activities)
      .innerJoin(s.deals, eq(s.activities.deal_id, s.deals.id))
      .innerJoin(s.contacts, eq(s.deals.contact_id, s.contacts.id))
      .where(and(formDeal, eq(s.activities.ai, true)))
      .groupBy(s.activities.deal_id),
  ]);
  const replyAt = new Map(firstReplies.map((r) => [r.run_id, r.at]));
  const noteAt = new Map(formFirstNotes.map((r) => [r.deal_id, r.at]));
  const runsOf = Map.groupBy(runs, (r) => r.channel_id);

  return channels.map((c) => {
    if (c.kind === "voice") return channelView(c, callsToday[0]?.n ?? 0, null);
    if (c.kind === "form") {
      const answered = formDeals.flatMap((d) => (noteAt.has(d.id) ? [(noteAt.get(d.id)!.getTime() - d.created_at.getTime()) / 1000] : []));
      return channelView(c, formDeals.filter((d) => d.created_at >= today).length, answered.length ? mean(answered) : null);
    }
    const mine = runsOf.get(c.id) ?? [];
    const answered = mine.flatMap((r) => {
      const at = replyAt.get(r.id) ?? (r.reply ? r.updated_at : null);
      return at ? [Math.max(0, (at.getTime() - r.created_at.getTime()) / 1000)] : [];
    });
    return channelView(c, mine.filter((r) => r.created_at >= today).length, answered.length ? mean(answered) : null);
  });
}

function channelSlug(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "channel";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  return id;
}

/* ───── Connectors ───── */

const CONNECTOR_META: Record<string, { color: string; capabilities: string[] }> = {
  zendesk: { color: "#03363D", capabilities: ["Open and update tickets", "Reply to customers", "Internal notes", "Escalate to a person", "Read ticket history"] },
  shop: { color: "#00BAF2", capabilities: ["Look up orders", "Check payment status", "Refunds to the original payment method"] },
  hubspot: { color: "#FF7A59", capabilities: ["Create contacts and deals", "Score leads", "Move deals between stages", "Deal notes", "Book meetings"] },
  sarvam: { color: "#1A73E8", capabilities: ["Outbound sales calls", "Call transcripts and summaries", "Lead details from calls"] },
};
/** The `tool` names the agents record on their steps → the connector that tool goes through. */
const TOOL_CONNECTOR: Record<string, string> = { Zendesk: "zendesk", ShopKart: "shop", Paytm: "shop", HubSpot: "hubspot", Sarvam: "sarvam" };

async function loadConnectors(): Promise<CR.Connector[]> {
  const today = startOfToday();
  const [connectors, steps, crmToday, callsToday] = await Promise.all([
    listConnectors(),
    db.select({ tool: s.agentSteps.tool, n: count() }).from(s.agentSteps).where(gte(s.agentSteps.created_at, today)).groupBy(s.agentSteps.tool),
    // The sales and leads agents act in HubSpot without a run, so their CRM activities count instead.
    db.select({ n: count() }).from(s.activities).where(and(gte(s.activities.created_at, today), eq(s.activities.ai, true))),
    db.select({ n: count() }).from(s.calls).where(gte(s.calls.created_at, today)),
  ]);
  const actions = new Map<string, number>();
  for (const x of steps) {
    const id = TOOL_CONNECTOR[x.tool];
    if (id) actions.set(id, (actions.get(id) ?? 0) + x.n);
  }
  actions.set("hubspot", (actions.get("hubspot") ?? 0) + (crmToday[0]?.n ?? 0));
  actions.set("sarvam", (actions.get("sarvam") ?? 0) + (callsToday[0]?.n ?? 0));
  const ORDER = ["zendesk", "shop", "hubspot", "sarvam"];
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return [...connectors].sort((a, b) => rank(a.id) - rank(b.id)).map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    color: CONNECTOR_META[c.id]?.color ?? "#64748B",
    capabilities: CONNECTOR_META[c.id]?.capabilities ?? [],
    status: c.status,
    ...(c.id === "zendesk" && { primary: true }),
    lastSync: c.last_checked_at ?? "",
    actionsToday: actions.get(c.id) ?? 0,
  }));
}

/* ───── Board ───── */

const COLUMNS = ["todo", "doing", "done"] as const;
type Column = (typeof COLUMNS)[number];
type TaskRow = typeof s.boardTasks.$inferSelect;

const toTask = (t: TaskRow): CR.TeamTask => ({ id: String(t.id), position: t.position, title: t.title, owner: t.owner, tag: t.tag, column: t.column });

async function boardTasks(): Promise<CR.TeamTask[]> {
  const rows = await db.select().from(s.boardTasks);
  return rows
    .sort((a, b) => COLUMNS.indexOf(a.column) - COLUMNS.indexOf(b.column) || a.position - b.position || a.id - b.id)
    .map(toTask);
}

const text = (v: unknown, field: string, max = 200) => {
  if (typeof v !== "string") throw bad(`${field} must be text`);
  if (v.trim().length > max) throw bad(`${field} is too long (max ${max})`);
  return v.trim();
};

/** Moves a task to `column` at `position` and renumbers both columns 0, 1, 2… in one statement. */
async function moveTask(task: TaskRow, column: Column, position: number | undefined) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(s.boardTasks).where(inArray(s.boardTasks.column, [...new Set([task.column, column])])).for("update");
    const order = (col: Column) => rows.filter((r) => r.column === col && r.id !== task.id).sort((a, b) => a.position - b.position || a.id - b.id);
    const target = order(column);
    const at = position === undefined ? (task.column === column ? Math.min(task.position, target.length) : target.length) : Math.max(0, Math.min(Math.trunc(position), target.length));
    target.splice(at, 0, task);
    const plan = [...target.map((r, i) => ({ id: r.id, column, position: i })), ...(task.column === column ? [] : order(task.column).map((r, i) => ({ id: r.id, column: task.column, position: i })))];
    const values = sql.join(plan.map((p) => sql`(${p.id}::int, ${p.column}::text, ${p.position}::int)`), sql`, `);
    await tx.execute(sql`update ${s.boardTasks} set "column" = v.col, "position" = v.pos from (values ${values}) as v(id, col, pos) where ${s.boardTasks.id} = v.id`);
  });
}

/* ───── Routes ───── */

export const controlRoomRoutes = {
  "/control-room/tickets": {
    GET: handle(async () => ok({ tickets: (await loadTickets()).map((t) => t.ticket) })),
  },
  "/control-room/tickets/:id": {
    GET: handle(async (req) => ok({ ticket: await oneTicket(intParam(req.params.id, "Ticket id")) })),
    PATCH: handle(async (req) => {
      const id = intParam(req.params.id, "Ticket id");
      const b = await body<{ status?: CR.Status }>(req);
      const status = oneOf(b.status, ["open", "in_progress", "waiting", "solved"] as const, "status");
      // Through Zendesk's own update, so its usual side effects (timestamps, status rules) apply.
      await updateTicket(id, { status: STATUS_TO_ZENDESK[status], actor: "human" });
      return ok({ ticket: await oneTicket(id) });
    }),
  },

  "/control-room/conversations": {
    GET: handle(async () => ok({ conversations: (await loadConversations()).map((c) => c.conversation) })),
  },

  "/control-room/leads": {
    GET: handle(async () => ok({ leads: (await loadLeads()).map((l) => l.lead) })),
  },
  "/control-room/leads/:id": {
    GET: handle(async (req) => ok({ lead: await oneLead(intParam(req.params.id, "Lead id")) })),
    PATCH: handle(async (req) => {
      const id = intParam(req.params.id, "Lead id");
      const b = await body<{ stage?: string; value?: number; name?: string; company?: string }>(req);
      const [deal] = await db.select({ contact_id: s.deals.contact_id }).from(s.deals).where(eq(s.deals.id, id));
      if (!deal) throw notFound(`Lead ${id}`);
      if (b.value !== undefined && (typeof b.value !== "number" || !Number.isFinite(b.value) || b.value < 0)) throw bad("value must be a positive number (₹)");
      if (b.stage !== undefined || b.value !== undefined) {
        await updateDeal(id, {
          ...(b.stage !== undefined && { stage: stageId(text(b.stage, "stage")) }),
          ...(b.value !== undefined && { amount: b.value }),
          actor: "human",
          author: OWNER.name,
        });
      }
      if (b.name !== undefined || b.company !== undefined) {
        await updateContact(deal.contact_id, { ...(b.name !== undefined && { name: text(b.name, "name") }), ...(b.company !== undefined && { company: text(b.company, "company") }) });
      }
      return ok({ lead: await oneLead(id) });
    }),
  },

  "/control-room/approvals": {
    GET: handle(async () => ok(await loadApprovals())),
  },
  "/control-room/approvals/:id/decide": {
    POST: handle(async (req) => {
      const b = await body<{ decision?: CR.Decision; note?: string }>(req);
      const decision = oneOf(b.decision, ["approved", "rejected"] as const, "decision");
      const { warning } = await decideApproval(approvalId(req.params.id), { decision, note: b.note, decided_by: OWNER.name });
      return ok({ ok: true, ...(warning && { warning }) });
    }),
  },

  "/control-room/stats": {
    GET: handle(async () => ok(await computeStats())),
  },

  "/control-room/channels": {
    GET: handle(async () => ok({ channels: await loadChannels(), catalog: CHANNEL_CATALOG })),
    /** Adds a real token channel (website chat, WhatsApp, email, API). The token is in this response only. */
    POST: handle(async (req) => {
      const b = await body<{ name?: string; kind?: string }>(req);
      const name = text(b.name, "name", 60);
      if (!name) throw bad("name is required");
      const kind = oneOf(b.kind, CHANNEL_CATALOG.map((c) => c.id as CR.ChannelId), "kind");
      const taken = new Set((await db.select({ id: s.channels.id }).from(s.channels)).map((c) => c.id));
      const id = channelSlug(name, taken);
      await db.insert(s.channels).values({ id, name, kind: kind as typeof s.channels.$inferInsert.kind });
      const token = newToken();
      await setChannelToken(id, token);
      const [row] = await db.select().from(s.channels).where(eq(s.channels.id, id));
      return ok({ channel: channelView(row!, 0, null), token }, 201);
    }),
  },

  "/control-room/connectors": {
    GET: handle(async () => ok({ connectors: await loadConnectors(), catalog: [] as CR.ConnectorOffer[] })),
  },

  "/control-room/settings": {
    GET: handle(async () => ok(await getSettings())),
    PUT: handle(async (req) => ok(await saveSettings(await body<Partial<CR.Settings>>(req)))),
  },

  "/control-room/board": {
    GET: handle(async () => ok({ tasks: await boardTasks() })),
    POST: handle(async (req) => {
      const b = await body<{ title?: string; owner?: string; tag?: string; column?: string }>(req);
      const title = text(b.title, "title");
      if (!title) throw bad("title is required");
      const column = b.column === undefined ? "todo" : oneOf(b.column, COLUMNS, "column");
      const [row] = await db
        .insert(s.boardTasks)
        .values({
          title,
          owner: b.owner === undefined ? "" : text(b.owner, "owner", 60),
          tag: b.tag === undefined ? "" : text(b.tag, "tag", 40),
          column,
          // At the end of its column.
          position: sql`(select coalesce(max(${s.boardTasks.position}), -1) + 1 from ${s.boardTasks} where ${s.boardTasks.column} = ${column})`,
        })
        .returning();
      return ok({ task: toTask(row!) }, 201);
    }),
  },
  "/control-room/board/:id": {
    PATCH: handle(async (req) => {
      const id = intParam(req.params.id, "Task id");
      const b = await body<{ title?: string; owner?: string; tag?: string; column?: string; position?: number }>(req);
      const [task] = await db.select().from(s.boardTasks).where(eq(s.boardTasks.id, id));
      if (!task) throw notFound(`Task ${id}`);
      const next: Partial<typeof s.boardTasks.$inferInsert> = {};
      if (b.title !== undefined) {
        next.title = text(b.title, "title");
        if (!next.title) throw bad("title can't be empty");
      }
      if (b.owner !== undefined) next.owner = text(b.owner, "owner", 60);
      if (b.tag !== undefined) next.tag = text(b.tag, "tag", 40);
      if (b.position !== undefined && (typeof b.position !== "number" || !Number.isFinite(b.position))) throw bad("position must be a number");
      if (Object.keys(next).length) await db.update(s.boardTasks).set(next).where(eq(s.boardTasks.id, id));
      if (b.column !== undefined || b.position !== undefined) {
        await moveTask(task, b.column === undefined ? task.column : oneOf(b.column, COLUMNS, "column"), b.position);
      }
      const [row] = await db.select().from(s.boardTasks).where(eq(s.boardTasks.id, id));
      return ok({ task: toTask(row!) });
    }),
    DELETE: handle(async (req) => {
      const id = intParam(req.params.id, "Task id");
      const [row] = await db.delete(s.boardTasks).where(eq(s.boardTasks.id, id)).returning({ id: s.boardTasks.id });
      if (!row) throw notFound(`Task ${id}`);
      return ok({ ok: true });
    }),
  },
};
