/**
 * Voice calls (Sarvam): the Control Room places an outbound sales call with the "Aria · Sales Caller"
 * voice agent, and when the call ends what it collected becomes CRM records (contact, deal, a "call"
 * activity on the deal's timeline) so the lead shows up in HubSpot and the Control Room.
 *
 * Results come back two ways, applied the same way and idempotently:
 *  - Sarvam's webhook, POST /sarvam/webhook/:token, when PUBLIC_API_URL is set (Sarvam must reach it);
 *  - polling Sarvam's analytics (every 30 s for calls still ringing, or POST /resolveai/calls/:id/sync).
 *
 * Webhook token: one per call, `<call id>.<HMAC-SHA256(secret, "rai_call:<id>")>`. The secret is
 * SARVAM_WEBHOOK_TOKEN, else one derived from DATABASE_URL (a server-only secret that is the same on
 * every start), so webhooks for calls placed before a restart still verify and nothing extra is stored.
 * A token only ever opens its own call, and a webhook naming another attempt id is refused.
 */
import { BOT, DEAL_STAGES, ENQUIRY_NEEDS, languageFor, rupees, type Call, type CallExtraction, type CallStatus, type DealStage, type PlaceCallBody, type SupportCallBody, OWNER } from "@ph/shared";
import { timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, schema as s, sql, toCall } from "@ph/db";
import { createContact, createDeal, findDeal, logActivity, updateDeal } from "./crm.ts";
import { db } from "./db.ts";
import { bad, body, handle, HttpError, intParam, notFound, ok } from "./http.ts";
import { appFor, getTranscript, listAttempts, parseAttempt, parseWebhook, placeOutbound, SarvamError, sarvamConfig, type CallResult, type SarvamConfig } from "./sarvam.ts";
import { voiceChannelToken } from "./resolveai.ts";
import { findCustomer } from "./shop.ts";
import { addComment, findTicket, updateTicket } from "./zendesk.ts";

type CallRow = typeof s.calls.$inferSelect;

/** `force: true` places the call outside 09:00–21:00 IST (for a demo after hours). */
type PlaceCall = (Partial<PlaceCallBody> & { force?: boolean; purpose?: "sales" }) | SupportCallBody;
const AGENT_URL = process.env.AGENT_URL?.trim().replace(/\/+$/, "") || "";

const PUBLIC_API_URL = process.env.PUBLIC_API_URL?.trim().replace(/\/+$/, "") || "";
const FINAL: CallStatus[] = ["completed", "no_answer", "failed"];
const LIVE: CallStatus[] = ["queued", "ringing", "in_progress"];
const POLL_EVERY_MS = 30_000;
const POLL_AFTER_MS = 60_000;
const GIVE_UP_MS = 30 * 60_000;
/** A connected attempt whose analysis hasn't landed yet: keep polling this long after it ended. */
const ANALYSIS_GRACE_MS = 3 * 60_000;

/* ───── Webhook tokens ───── */

const WEBHOOK_SECRET = process.env.SARVAM_WEBHOOK_TOKEN?.trim() || new Bun.CryptoHasher("sha256").update(`sarvam-webhook:${process.env.DATABASE_URL}`).digest("hex");

const sign = (id: number) => new Bun.CryptoHasher("sha256", WEBHOOK_SECRET).update(`rai_call:${id}`).digest("hex").slice(0, 32);
const webhookToken = (id: number) => `${id}.${sign(id)}`;

/** The call id a webhook token opens, or null if it isn't one of ours. */
function verifyToken(token: string): number | null {
  const m = /^(\d+)\.([0-9a-f]{32})$/.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  const want = Buffer.from(sign(id));
  const got = Buffer.from(m[2]!);
  return timingSafeEqual(want, got) ? id : null;
}

/* ───── Phone numbers ───── */

/** Indian mobile number in E.164 (+91 and 10 digits from 6–9), from "+91 90000 40001", "09000040001", "9000040001"… */
export function toE164(raw: string): string | null {
  let d = raw.replace(/[\s().-]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return /^91[6-9]\d{9}$/.test(d) ? `+${d}` : null;
}

/** How the CRM writes numbers: "+91 90000 40001". */
const crmPhone = (e164: string) => `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;

/** Hours in Asia/Kolkata when we may call people. */
function inCallingHours(at = new Date()): boolean {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(at)
    .split(":")
    .map(Number);
  const minutes = (h! % 24) * 60 + m!;
  return minutes >= 9 * 60 && minutes < 21 * 60;
}

/* ───── Reading ───── */

async function findCall(id: number): Promise<CallRow> {
  const [row] = await db.select().from(s.calls).where(eq(s.calls.id, id));
  if (!row) throw notFound(`Call ${id}`);
  return row;
}

async function saveCall(id: number, set: Partial<typeof s.calls.$inferInsert>): Promise<CallRow> {
  const [row] = await db
    .update(s.calls)
    .set({ ...set, updated_at: new Date() })
    .where(eq(s.calls.id, id))
    .returning();
  return row!;
}

/* ───── Placing a call ───── */

async function placeCall(b: PlaceCall): Promise<Call> {
  if (b.purpose === "support") return placeSupportCall(b);
  let { name = "", business_name = "", phone = "" } = b as Partial<PlaceCallBody>;
  let contactId: number | null = null;
  let dealId: number | null = null;
  if (b.deal_id !== undefined && b.deal_id !== null) {
    const deal = await findDeal(intParam(String(b.deal_id), "deal_id"));
    const [contact] = await db.select().from(s.contacts).where(eq(s.contacts.id, deal.contact_id));
    dealId = deal.id;
    contactId = contact?.id ?? null;
    phone = phone.trim() || contact?.phone || "";
    name = name.trim() || contact?.name || "";
    business_name = business_name.trim() || contact?.company || "";
  }
  name = name.trim();
  business_name = business_name.trim();
  if (!name) throw bad("name is required (who Aria is calling)");
  if (!phone.trim()) throw bad("phone is required");
  const e164 = toE164(phone);
  if (!e164) throw bad(`${phone} isn't an Indian mobile number. Use +91 and 10 digits, e.g. +919876543210.`);

  const [suppressed] = await db
    .select({ id: s.calls.id })
    .from(s.calls)
    .where(and(eq(s.calls.phone, e164), eq(s.calls.outcome, "do_not_call")))
    .limit(1);
  if (suppressed) throw new HttpError(409, `${crmPhone(e164)} asked not to be called again (call #${suppressed.id}). It's on the do-not-call list.`);
  if (!b.force && !inCallingHours())
    throw new HttpError(409, "It's outside calling hours (09:00–21:00 IST). Calls go out only in that window; send force: true to call anyway.");

  const cfg = await sarvamConfig();
  if (!cfg.ok) throw new HttpError(503, cfg.reason);

  const [row] = await db
    .insert(s.calls)
    .values({ phone: e164, name, business_name, contact_id: contactId, deal_id: dealId, status: "queued" })
    .returning();
  const call = row!;
  await db.update(s.channels).set({ last_used_at: new Date() }).where(eq(s.channels.id, "sarvam_voice"));

  let attemptId: string;
  try {
    attemptId = await placeOutbound(cfg.config, {
      phone: e164,
      variables: {
        contact_name: name,
        business_name: business_name || name,
        lead_source: dealId ? `HubSpot deal #${dealId}` : "ResolveAI Control Room",
        company_name: "ResolveAI",
        sales_rep_name: OWNER.first,
      },
      webhook: PUBLIC_API_URL ? { url: `${PUBLIC_API_URL}/sarvam/webhook/${webhookToken(call.id)}`, metadata: { call_id: String(call.id) } } : undefined,
    });
  } catch (e) {
    const message = e instanceof SarvamError ? e.message : "Couldn't place the call with Sarvam";
    if (!(e instanceof SarvamError)) console.error("sarvam: place call failed", e instanceof Error ? e.message : e);
    await saveCall(call.id, { status: "failed", error: message, ended_at: new Date() });
    throw new HttpError(502, message);
  }
  const placed = await saveCall(call.id, { status: "ringing", external_id: attemptId });
  if (dealId) await withLock(call.id, () => upsertCallActivity(placed, `Aria · Sales Caller is calling ${name} on ${crmPhone(e164)}.`));
  return toCall(placed);
}

/* ───── Support calls: phone a customer for the details their request is missing ───── */

/** A step on the agent run this call belongs to, so the request's trace shows the call. */
async function runStep(runId: number | null, step: string, result: "success" | "blocked" | "escalated", detail: string) {
  if (!runId) return;
  await db.insert(s.agentSteps).values({ run_id: runId, agent: "main", step, tool: "Sarvam", result, detail: detail.slice(0, 500) }).catch((e) => console.warn(`calls: couldn't add a step to run ${runId}: ${e instanceof Error ? e.message : e}`));
}

async function ticketNote(ticketId: number | null, body: string, publicReply = false) {
  if (!ticketId) return;
  await addComment(ticketId, { body, public: publicReply }).catch((e) => console.warn(`calls: couldn't comment on ticket #${ticketId}: ${e instanceof Error ? e.message : e}`));
}

async function placeSupportCall(b: SupportCallBody): Promise<Call> {
  const customer = await findCustomer(intParam(String(b.customer_id ?? ""), "customer_id"));
  const reason = String(b.reason ?? "").trim();
  const questions = (Array.isArray(b.questions) ? b.questions : []).map((q) => String(q).trim()).filter(Boolean);
  if (!reason) throw bad("reason is required: why Aria is calling, e.g. \"you wrote that an item arrived damaged, but we couldn't tell which order\"");
  if (!questions.length || questions.length > 5) throw bad("questions needs 1 to 5 details to collect");
  const ticketId = b.ticket_id == null ? null : intParam(String(b.ticket_id), "ticket_id");
  if (ticketId) await findTicket(ticketId);

  // One support call at a time per customer: a second request while one is live gets that call back.
  const [live] = await db
    .select()
    .from(s.calls)
    .where(and(eq(s.calls.purpose, "support"), eq(s.calls.customer_id, customer.id), inArray(s.calls.status, LIVE)))
    .orderBy(desc(s.calls.id))
    .limit(1);
  if (live) throw new HttpError(409, `Aria is already calling ${customer.name} (call #${live.id}).`);
  if (!b.force && !inCallingHours())
    throw new HttpError(409, "It's outside calling hours (09:00–21:00 IST). Calls go out only in that window; send force: true to call anyway.");

  const cfg = await sarvamConfig();
  if (!cfg.ok) throw new HttpError(503, cfg.reason);
  // The demo's customers have made-up numbers: with SARVAM_TEST_NUMBER set, the call rings that verified phone.
  const dial = toE164(cfg.config.supportTestNumber || customer.phone);
  if (!dial) throw bad(`${customer.name}'s number ${customer.phone} isn't an Indian mobile number`);
  const language = languageFor(customer.city);

  const [row] = await db
    .insert(s.calls)
    .values({
      purpose: "support",
      phone: dial,
      name: customer.name,
      business_name: "",
      customer_id: customer.id,
      ticket_id: ticketId,
      session_id: b.session_id?.trim() || null,
      run_id: b.run_id ?? null,
      language,
      reason,
      status: "queued",
    })
    .returning();
  const call = row!;
  await db.update(s.channels).set({ last_used_at: new Date() }).where(eq(s.channels.id, "sarvam_voice"));

  let attemptId: string;
  try {
    attemptId = await placeOutbound(cfg.config, {
      purpose: "support",
      phone: dial,
      variables: {
        customer_name: customer.name.split(" ")[0] ?? customer.name,
        company_name: "ShopKart",
        owner_name: OWNER.first,
        preferred_language: language,
        reason,
        questions: questions.join("; "),
        order_ref: b.order_id ? `#${b.order_id}` : "",
        ticket_ref: ticketId ? `#${ticketId}` : "",
      },
      webhook: PUBLIC_API_URL ? { url: `${PUBLIC_API_URL}/sarvam/webhook/${webhookToken(call.id)}`, metadata: { call_id: String(call.id) } } : undefined,
    });
  } catch (e) {
    const message = e instanceof SarvamError ? e.message : "Couldn't place the call with Sarvam";
    if (!(e instanceof SarvamError)) console.error("sarvam: place support call failed", e instanceof Error ? e.message : e);
    await saveCall(call.id, { status: "failed", error: message, ended_at: new Date() });
    await runStep(call.run_id, "Call for details", "blocked", `Couldn't call ${customer.name}: ${message}`);
    throw new HttpError(502, message);
  }
  const placed = await saveCall(call.id, { status: "ringing", external_id: attemptId });
  const to = cfg.config.supportTestNumber ? `the test number ${crmPhone(dial)} (for ${customer.name})` : crmPhone(dial);
  await Promise.all([
    runStep(call.run_id, "Call for details", "success", `Aria · Support Caller is calling ${to}, opening in ${language}: ${questions.join("; ")}`),
    ticketNote(ticketId, `Aria · Support Caller is calling ${customer.name} on ${to} (opens in ${language}, switches to whatever they speak) to collect: ${questions.join("; ")}.\nWhy: ${reason}.\n(call #${call.id})`),
  ]);
  return toCall(placed);
}

const INFO_LABEL: Record<string, string> = {
  info_collected: "got the details",
  partial: "got some of the details",
  callback: "asked to be called back",
  declined: "didn't want to give details",
  wrong_person: "reached the wrong person",
  unclear: "no clear answers",
};
const WANTS_LABEL: Record<string, string> = {
  refund: "a refund", replacement: "a replacement", return: "to return it", cancel: "to cancel the order",
  delivery_update: "a delivery update", information: "an answer", other: "something else",
};

/** What the customer said on the phone, as their own message to support, so the agent can continue. */
function phoneMessage(call: CallRow): string {
  const x = call.extracted;
  return [
    "(Said on the phone call with Aria)",
    x.order_number ? `It's about order ${x.order_number}${x.product ? `, the ${x.product}` : ""}.` : x.product ? `It's about the ${x.product}.` : null,
    x.issue_details ?? null,
    x.wants && WANTS_LABEL[x.wants] ? `I'd like ${WANTS_LABEL[x.wants]}.` : null,
    !x.issue_details && call.summary ? call.summary : null,
  ].filter(Boolean).join(" ");
}

function supportNote(call: CallRow): string {
  const x = call.extracted;
  if (call.status === "no_answer") return `Aria · Support Caller called ${call.name}: no answer.${call.error ? ` ${call.error}.` : ""}\n(call #${call.id})`;
  if (call.status === "failed") return `Aria · Support Caller couldn't reach ${call.name}: the call failed${call.error ? ` (${call.error})` : ""}.\n(call #${call.id})`;
  const facts = [
    x.order_number && `Order: ${x.order_number}`,
    x.product && `Product: ${x.product}`,
    x.issue_details && `Problem: ${x.issue_details}`,
    x.wants && x.wants !== "not_discussed" && `Wants: ${WANTS_LABEL[x.wants] ?? x.wants}`,
    x.best_time && `Call back: ${x.best_time}`,
    x.language_used && `Spoke: ${x.language_used}`,
  ].filter(Boolean);
  return [
    `Aria · Support Caller spoke with ${call.name}${call.duration_s ? ` for ${minutes(call.duration_s)}` : ""}: ${INFO_LABEL[x.info_outcome ?? "unclear"]}.`,
    call.summary,
    facts.length ? `${facts.join(". ")}.` : null,
    `(call #${call.id})`,
  ].filter(Boolean).join("\n");
}

/** A finished support call: note it on the ticket and the run, then hand the answers back to the agent (once). */
async function applySupport(call: CallRow) {
  const x = call.extracted;
  const got = call.status === "completed" && (x.info_outcome === "info_collected" || x.info_outcome === "partial");
  await Promise.all([
    ticketNote(call.ticket_id, supportNote(call)),
    runStep(call.run_id, "Call result", got ? "success" : "escalated", supportNote(call).split("\n")[0]!),
  ]);
  if (call.continued_at) return;
  await saveCall(call.id, { continued_at: new Date() });

  if (got && call.session_id && call.customer_id && AGENT_URL) {
    // The answers continue the request in the customer's chat session, like a message they typed.
    try {
      const res = await fetch(`${AGENT_URL}/intake`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await voiceChannelToken()}` },
        body: JSON.stringify({ session_id: call.session_id, customer_id: call.customer_id, message: phoneMessage(call) }),
        signal: AbortSignal.timeout(110_000),
      });
      if (!res.ok) throw new Error(`agent answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    } catch (e) {
      console.warn(`calls: couldn't hand call #${call.id} back to the agent: ${e instanceof Error ? e.message : e}`);
    }
  }
  // Nothing usable came back (or the agent couldn't take it): the customer is asked in the chat, and the
  // owner takes the ticket.
  if (!call.ticket_id) return;
  const tried = call.status === "completed" ? "We just spoke on the phone" : "We tried calling you";
  const ask = got ? "" : " Could you reply here with the details, or tell us a good time to call?";
  await ticketNote(call.ticket_id, `${tried} to get a few details for this request.${ask} ${OWNER.first} from our team will follow up here.`, true);
  await updateTicket(call.ticket_id, { assignee: OWNER.name, status: "open", handled_by: "human" }).catch((e) =>
    console.warn(`calls: couldn't hand ticket #${call.ticket_id} to ${OWNER.name}: ${e instanceof Error ? e.message : e}`),
  );
}

/* ───── Applying a result (webhook or poll) ───── */

const locks = new Map<number, Promise<unknown>>();
/** One update per call at a time, so a webhook and a poll arriving together can't both create a deal. */
function withLock<T>(id: number, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
  locks.set(id, run);
  void run.finally(() => locks.get(id) === run && locks.delete(id)).catch(() => {});
  return run;
}

/** Stores what Sarvam sent and, once the call is over, writes it into the CRM. Safe to repeat. */
async function applyResult(id: number, r: CallResult, cfg: SarvamConfig | null): Promise<CallRow> {
  return withLock(id, async () => {
    const call = await findCall(id);
    let transcript = r.transcript;
    if (!transcript.length && r.interactionId && cfg && r.status && FINAL.includes(r.status)) {
      transcript = await getTranscript(cfg, r.interactionId, appFor(cfg, call.purpose).id).catch((e) => {
        console.warn(`sarvam: transcript for call #${id} not available yet (${e instanceof Error ? e.message : e})`);
        return [];
      });
    }
    // A late "ringing" never undoes a finished call.
    const status = r.status && !(FINAL.includes(call.status) && !FINAL.includes(r.status)) ? r.status : call.status;
    const extracted: CallExtraction = { ...call.extracted, ...r.extracted };
    const final = FINAL.includes(status);
    const saved = await saveCall(id, {
      status,
      external_id: call.external_id ?? r.attemptId,
      duration_s: r.durationS ?? call.duration_s,
      transcript: transcript.length ? transcript : call.transcript,
      extracted,
      outcome: extracted.call_outcome ?? call.outcome,
      lead_score: extracted.lead_score ?? call.lead_score,
      summary: extracted.call_summary ?? call.summary,
      error: r.failure ?? (status === "completed" ? null : call.error),
      ended_at: final ? (r.endedAt ?? call.ended_at ?? new Date()) : call.ended_at,
    });
    if (final) await (saved.purpose === "support" ? applySupport(saved) : applyToCrm(saved));
    return saved;
  });
}

const QUALIFIED = new Set(["meeting_booked", "send_details", "callback"]);
const OUTCOME_LABEL: Record<string, string> = {
  meeting_booked: `Intro call with ${OWNER.first} booked`,
  send_details: "Wants details sent",
  callback: "Asked for a call back",
  not_interested: "Not interested",
  do_not_call: "Asked not to be called again",
  wrong_person: "Wrong person",
  unclear: "No clear outcome",
};
const needLabel = (x: CallExtraction) => ENQUIRY_NEEDS.find((n) => n.id === x.need)?.label ?? "Enquiry";
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const minutes = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`);

function nextStep(x: CallExtraction): string {
  switch (x.call_outcome) {
    case "meeting_booked":
      return x.meeting_time ? `Intro call with ${OWNER.first} ${x.meeting_time}` : `Intro call with ${OWNER.first} booked: confirm the time`;
    case "send_details":
      return x.whatsapp_ok ? "Send the details on WhatsApp" : x.email ? `Email the details to ${x.email}` : "Send the details";
    case "callback":
      return `Call back${x.meeting_time ? ` ${x.meeting_time}` : x.start_when ? ` (${x.start_when})` : ""}`;
    default:
      return "";
  }
}

/** The timeline note for a call: what happened, what was captured, and why it scored as it did. */
function callNote(call: CallRow): string {
  const x = call.extracted;
  const who = `${call.name} (${crmPhone(call.phone)})`;
  if (call.status === "no_answer") return `Aria · Sales Caller called ${who}: no answer.${call.error ? ` ${call.error}.` : ""}`;
  if (call.status === "failed") return `Aria · Sales Caller couldn't reach ${who}: the call failed${call.error ? ` (${call.error})` : ""}.`;
  const facts = [
    x.need && x.need !== "not_discussed" && `Need: ${needLabel(x).toLowerCase()}${x.need_details ? ` (${x.need_details})` : ""}`,
    x.budget_inr !== undefined && x.budget_inr !== null && `Budget ${rupees(x.budget_inr)}`,
    x.monthly_volume && `Volume: ${x.monthly_volume}`,
    x.start_when && `Wants to start: ${x.start_when}`,
    x.is_decision_maker && x.is_decision_maker !== "not_discussed" && `Decision maker: ${x.is_decision_maker}`,
    x.current_setup && `Uses today: ${x.current_setup}`,
    x.business_type && `Business: ${x.business_type}${x.city ? `, ${x.city}` : ""}`,
    !x.business_type && x.city && `City: ${x.city}`,
    x.meeting_time && (x.call_outcome === "callback" ? `Call back: ${x.meeting_time}` : `Intro call with ${OWNER.first}: ${x.meeting_time}`),
    x.email && `Email: ${x.email}`,
    x.whatsapp_ok !== undefined && `WhatsApp OK: ${x.whatsapp_ok ? "yes" : "no"}`,
    x.objections && `Objections: ${x.objections}`,
  ].filter(Boolean);
  return [
    `Aria · Sales Caller spoke with ${who}${call.duration_s ? ` for ${minutes(call.duration_s)}` : ""}. Outcome: ${OUTCOME_LABEL[call.outcome ?? "unclear"]}.`,
    call.summary,
    facts.length ? `${facts.join(". ")}.` : null,
    call.lead_score ? `Scored ${cap(call.lead_score)}${x.score_reason ? `: ${x.score_reason}` : ""}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** One "call" activity per call on the deal's timeline, updated in place as the call progresses. */
async function upsertCallActivity(call: CallRow, text: string, dealId = call.deal_id) {
  if (!dealId) return;
  const body = `${text}\n(call #${call.id})`;
  const [existing] = await db
    .select({ id: s.activities.id })
    .from(s.activities)
    .where(and(eq(s.activities.deal_id, dealId), eq(s.activities.type, "call"), sql`${s.activities.body} like ${`%(call #${call.id})`}`))
    .limit(1);
  if (!existing) return void (await logActivity(dealId, { type: "call", body, author: BOT, ai: true }));
  await Promise.all([
    db.update(s.activities).set({ body }).where(eq(s.activities.id, existing.id)),
    db.update(s.deals).set({ updated_at: new Date() }).where(eq(s.deals.id, dealId)),
  ]);
}

/** A contact with this email or phone number, else a new one. */
async function contactFor(call: CallRow): Promise<number> {
  const x = call.extracted;
  const last10 = call.phone.slice(-10);
  const [match] = await db
    .select({ id: s.contacts.id })
    .from(s.contacts)
    .where(
      x.email
        ? sql`lower(trim(${s.contacts.email})) = ${x.email} or right(regexp_replace(${s.contacts.phone}, '\\D', '', 'g'), 10) = ${last10}`
        : sql`right(regexp_replace(${s.contacts.phone}, '\\D', '', 'g'), 10) = ${last10}`,
    )
    .orderBy(desc(s.contacts.id))
    .limit(1);
  if (match) return match.id;
  const values = {
    name: x.contact_name_captured || call.name,
    phone: crmPhone(call.phone),
    company: x.business_name_captured || call.business_name || call.name,
    source: "Voice call" as const,
  };
  if (x.email) return (await createContact({ ...values, email: x.email })).id;
  // createContact needs an email; a phone lead may not have given one.
  const [row] = await db
    .insert(s.contacts)
    .values({ ...values, email: "", lead_status: "New", owner: BOT, created_at: new Date() })
    .returning({ id: s.contacts.id });
  return row!.id;
}

async function applyToCrm(call: CallRow) {
  const x = call.extracted;
  if (call.status !== "completed") return upsertCallActivity(call, callNote(call));
  if (!QUALIFIED.has(call.outcome ?? "")) return upsertCallActivity(call, callNote(call));

  if (call.deal_id) {
    const deal = await findDeal(call.deal_id);
    const forward: DealStage[] = ["new_lead", "qualified"];
    await updateDeal(deal.id, {
      ...(call.lead_score ? { score: call.lead_score } : {}),
      ...(nextStep(x) ? { next_step: nextStep(x) } : {}),
      ...(!deal.amount && x.budget_inr ? { amount: x.budget_inr } : {}),
      ...(call.outcome === "meeting_booked" && forward.includes(deal.stage) ? { stage: "meeting_booked" as const } : {}),
    });
    return upsertCallActivity(call, callNote(call));
  }

  // A cold call that found a lead: contact + deal, linked back to the call.
  const contactId = call.contact_id ?? (await contactFor(call));
  const company = x.business_name_captured || call.business_name || call.name;
  const deal = await createDeal({
    name: `${company} – ${needLabel(x)}`,
    amount: x.budget_inr ?? 0,
    contact_id: contactId,
    score: call.lead_score ?? "warm",
    stage: call.outcome === "meeting_booked" ? "meeting_booked" : DEAL_STAGES[0]!.id,
    next_step: nextStep(x),
  });
  await saveCall(call.id, { contact_id: contactId, deal_id: deal.id });
  await upsertCallActivity(call, callNote(call), deal.id);
}

/* ───── Polling Sarvam (fallback when no webhook arrives) ───── */

type SyncOutcome = "applied" | "pending" | "not_found";

async function syncFromSarvam(call: CallRow, cfg: SarvamConfig): Promise<SyncOutcome> {
  if (!call.external_id) return "not_found";
  const from = new Date(call.created_at.getTime() - 5 * 60_000);
  const to = new Date(Math.min(Date.now(), call.created_at.getTime() + 2 * 60 * 60_000));
  const attempt = (await listAttempts(cfg, from, to, appFor(cfg, call.purpose).id)).find((a) => a.attempt_id === call.external_id);
  if (!attempt) return "not_found";
  const r = parseAttempt(attempt);
  const ended = r.endedAt?.getTime() ?? Date.now();
  if (r.status === "completed" && !r.extracted.call_outcome && Date.now() - ended < ANALYSIS_GRACE_MS) {
    // Connected, but the post-call analysis isn't in yet: note the duration and look again next round.
    await applyResult(call.id, { ...r, status: "in_progress", extracted: {} }, null);
    return "pending";
  }
  await applyResult(call.id, r, cfg);
  return r.status && FINAL.includes(r.status) ? "applied" : "pending";
}

let polling = false;
async function pollLiveCalls() {
  if (polling) return;
  polling = true;
  try {
    const live = await db
      .select()
      .from(s.calls)
      .where(and(inArray(s.calls.status, LIVE), sql`${s.calls.created_at} < ${new Date(Date.now() - POLL_AFTER_MS)}`))
      .orderBy(s.calls.id)
      .limit(20);
    if (!live.length) return;
    const cfg = await sarvamConfig();
    for (const call of live) {
      const stale = Date.now() - call.created_at.getTime() > GIVE_UP_MS;
      try {
        if (cfg.ok && call.status !== "queued" && (await syncFromSarvam(call, cfg.config)) === "applied") continue;
      } catch (e) {
        console.warn(`sarvam: polling call #${call.id} failed: ${e instanceof Error ? e.message : e}`);
      }
      if (stale) await applyResult(call.id, { ...parseWebhook({}), status: "failed", failure: "No result from Sarvam" }, null);
    }
  } catch (e) {
    console.error("sarvam: call polling broke", e instanceof Error ? e.message : e);
  } finally {
    polling = false;
  }
}
setInterval(pollLiveCalls, POLL_EVERY_MS);

/* ───── Routes ───── */

export const callRoutes = {
  "/resolveai/calls": {
    GET: handle(async () => {
      const rows = await db.select().from(s.calls).orderBy(desc(s.calls.created_at), desc(s.calls.id)).limit(100);
      return ok({ calls: rows.map(toCall) });
    }),
    POST: handle(async (req) => ok(await placeCall(await body<PlaceCall>(req)), 201)),
  },
  "/resolveai/calls/:id": {
    GET: handle(async (req) => ok(toCall(await findCall(intParam(req.params.id, "Call id"))))),
  },
  "/resolveai/calls/:id/sync": {
    POST: handle(async (req) => {
      const call = await findCall(intParam(req.params.id, "Call id"));
      if (!call.external_id) throw new HttpError(409, `Call #${call.id} never reached Sarvam, so there is nothing to sync`);
      const cfg = await sarvamConfig();
      if (!cfg.ok) throw new HttpError(503, cfg.reason);
      try {
        await syncFromSarvam(call, cfg.config);
      } catch (e) {
        if (e instanceof SarvamError) throw new HttpError(502, e.message);
        throw e;
      }
      return ok(toCall(await findCall(call.id)));
    }),
  },
  /** Sarvam's post-call webhook. Public: the per-call token in the path is the credential. */
  "/sarvam/webhook/:token": {
    POST: handle(async (req) => {
      const id = verifyToken(req.params.token ?? "");
      if (id === null) throw new HttpError(401, "Unknown webhook token");
      const raw = await body<unknown>(req);
      const r = parseWebhook(raw);
      if (r.callId !== null && r.callId !== id) throw new HttpError(401, "This token is for another call");
      const call = await findCall(id);
      if (call.external_id && r.attemptId && r.attemptId !== call.external_id) throw new HttpError(409, `Attempt ${r.attemptId} isn't call #${id}'s`);
      // Answer Sarvam straight away; the CRM work happens after.
      void (async () => {
        const cfg = await sarvamConfig();
        await applyResult(id, r, cfg.ok ? cfg.config : null);
      })().catch((e) => console.error(`sarvam: webhook for call #${id} failed`, e instanceof Error ? e.message : e));
      return ok({ ok: true }, 202);
    }),
  },
};
