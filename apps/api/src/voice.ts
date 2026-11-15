/**
 * The phone line. A Sarvam voice agent answers calls to the ShopKart number (speech, Indian languages,
 * telephony); ResolveAI decides and acts. Sarvam reaches us at three endpoints:
 *
 *   POST /voice/caller  on-start hook: who is calling (sets the agent's greeting variables)
 *   POST /voice/turn    API tool "ask_resolveai": one thing the caller said → what to say back.
 *                       Runs the same support agent as the shop chat, so one call = one Zendesk ticket (via "voice").
 *   POST /voice/calls   the deployment's call-completion webhook: stores the call and puts the transcript
 *                       on its ticket (or opens one for a person when Aria never acted).
 *
 * GET /voice/calls and GET /voice/line feed the Control Room's Phone line page.
 * With VOICE_WEBHOOK_SECRET set, the POSTs need it as `Authorization: Bearer <secret>` (or `x-api-key`).
 */
import {
  BOT,
  type SarvamCallWebhook,
  type VoiceCall,
  type VoiceCallerResponse,
  type VoiceLine,
  type VoiceTranscriptTurn,
  type VoiceTurnResponse,
} from "@ph/shared";
import { and, count, desc, eq, gte, ne, schema as s, sql, toCustomer } from "@ph/db";
import type { Customer } from "@ph/shared";
import { runChat } from "./agent.ts";
import { db } from "./db.ts";
import { body, handle, HttpError, ok } from "./http.ts";
import { customerOrders } from "./shop.ts";
import { addComment, createTicket, ticketExists } from "./zendesk.ts";

const SECRET = process.env.VOICE_WEBHOOK_SECRET?.trim() || null;
const NUMBER = process.env.VOICE_NUMBER?.trim() || null;
const PUBLIC_URL = process.env.VOICE_PUBLIC_URL?.trim().replace(/\/$/, "") || null;
/** Demo fallback: a caller whose number isn't on file is treated as this customer. */
const DEFAULT_CUSTOMER = Number(process.env.VOICE_DEFAULT_CUSTOMER_ID) || null;
/** A call that hasn't reached us for this long, and never sent its end-of-call webhook, counts as ended. */
const STALE_MS = 15 * 60_000;
/** Sarvam waits at most 30 s for a tool; leave room to answer. */
const TURN_TIMEOUT_MS = 25_000;

function authorize(req: Request) {
  if (!SECRET) return;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const key = req.headers.get("x-api-key")?.trim();
  if (auth !== SECRET && key !== SECRET) throw new HttpError(401, "Send the VOICE_WEBHOOK_SECRET as a bearer token");
}

/* ───── Finding the customer ───── */

const last10 = (phone: string) => phone.replace(/\D/g, "").slice(-10);

/** Customers are few (the demo has five), so match in code: numbers are stored as "+91 90000 10101". */
async function customerByPhone(phone: string | undefined): Promise<Customer | null> {
  const want = phone ? last10(phone) : "";
  if (want.length < 10) return null;
  const rows = await db.select().from(s.customers);
  const hit = rows.find((c) => last10(c.phone) === want);
  return hit ? toCustomer(hit) : null;
}

/** What a caller says to identify themselves: a registered mobile number, an email or an order number. */
async function customerByAccount(text: string | undefined): Promise<Customer | null> {
  if (!text?.trim()) return null;
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
  if (email) {
    const [c] = await db.select().from(s.customers).where(sql`lower(${s.customers.email}) = ${email.toLowerCase()}`);
    if (c) return toCustomer(c);
  }
  const byPhone = await customerByPhone(text);
  if (byPhone) return byPhone;
  const orderId = text.match(/\b(\d{4})\b/)?.[1];
  if (orderId) {
    const [o] = await db.select({ customer_id: s.orders.customer_id }).from(s.orders).where(eq(s.orders.id, Number(orderId)));
    if (o) return findCustomerOrNull(o.customer_id);
  }
  return null;
}

async function findCustomerOrNull(id: number | null | undefined): Promise<Customer | null> {
  if (!id) return null;
  const [c] = await db.select().from(s.customers).where(eq(s.customers.id, id));
  return c ? toCustomer(c) : null;
}

/* ───── Speaking ───── */

/** The reply is read aloud: amounts as "1,250 rupees", no markdown or symbols a voice would spell out. */
export function speakable(text: string): string {
  return text
    .replace(/₹\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)/g, "$1 rupees")
    .replace(/(\d+)\s?×\s?/g, "$1 ")
    .replace(/#(\d+)/g, "number $1")
    .replace(/[*_`>#]+/g, "")
    .replace(/(\d)\s?–\s?(\d)/g, "$1 to $2")
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptNote(turns: VoiceTranscriptTurn[], phone: string, duration: number | undefined): string {
  const len = duration ? ` · ${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s` : "";
  const lines = turns
    .filter((t) => t.en_text?.trim())
    .slice(0, 80)
    .map((t) => `${t.role === "agent" ? "Aria" : "Caller"}: ${t.en_text.trim()}${t.indic_text?.trim() && t.indic_text.trim() !== t.en_text.trim() ? ` (${t.indic_text.trim()})` : ""}`);
  return [`Phone call transcript (${phone || "unknown number"}${len})`, ...lines].join("\n");
}

/* ───── Calls table ───── */

type CallRow = typeof s.voiceCalls.$inferSelect;

async function findCall(id: string): Promise<CallRow | null> {
  const [row] = await db.select().from(s.voiceCalls).where(eq(s.voiceCalls.interaction_id, id));
  return row ?? null;
}

/** Creates the call on first contact, then keeps it current. */
async function saveCall(id: string, set: Partial<Omit<CallRow, "interaction_id">>) {
  const at = new Date();
  await db
    .insert(s.voiceCalls)
    .values({ interaction_id: id, started_at: set.started_at ?? at, last_activity_at: at, ...set })
    .onConflictDoUpdate({ target: s.voiceCalls.interaction_id, set: { last_activity_at: at, ...set } });
}

const isLive = (r: Pick<CallRow, "status" | "last_activity_at">) => r.status === "live" && Date.now() - r.last_activity_at.getTime() < STALE_MS;

function toVoiceCall(r: CallRow, customer: { id: number; name: string } | null): VoiceCall {
  return {
    interaction_id: r.interaction_id,
    status: isLive(r) ? "live" : "ended",
    caller_phone: r.caller_phone,
    line_phone: r.line_phone,
    customer,
    ticket_id: r.ticket_id,
    turns: r.turns,
    duration: r.duration,
    transcript: r.transcript,
    started_at: r.started_at.toISOString(),
    last_activity_at: r.last_activity_at.toISOString(),
    ended_at: r.ended_at?.toISOString() ?? null,
  };
}

/* ───── Request bodies ───── */
// Sarvam's tool editor lets each workspace name the fields; accept the obvious spellings.

type Loose = Record<string, unknown>;
const str = (b: Loose, ...keys: string[]) => {
  for (const k of keys) if (typeof b[k] === "string" && (b[k] as string).trim()) return (b[k] as string).trim();
  for (const k of keys) if (typeof b[k] === "number") return String(b[k]);
  return undefined;
};
const phoneOf = (b: Loose) => str(b, "phone", "user_phone_number", "user_identifier", "caller", "from");
const callIdOf = (b: Loose) => str(b, "interaction_id", "call_id", "interactionId");

/* ───── Handlers ───── */

async function caller(b: Loose): Promise<VoiceCallerResponse> {
  const phone = phoneOf(b);
  const customer = (await customerByPhone(phone)) ?? (await findCustomerOrNull(DEFAULT_CUSTOMER));
  const callId = callIdOf(b);
  if (callId) await saveCall(callId, { caller_phone: phone ?? "", customer_id: customer?.id ?? null, status: "live" });
  if (!customer) {
    return { known: false, customer_id: null, customer_name: "", first_name: "", orders_summary: "", greeting: "Hi, this is Aria from ShopKart. How can I help you today?" };
  }
  const first = customer.name.split(" ")[0]!;
  const orders = (await customerOrders(customer.id)).slice(0, 3);
  const orders_summary = orders.map((o) => `order ${o.id}, ${o.items[0]?.name ?? "items"}${o.items.length > 1 ? " and more" : ""}, ${o.status}`).join("; ");
  return { known: true, customer_id: customer.id, customer_name: customer.name, first_name: first, orders_summary, greeting: `Hi ${first}, this is Aria from ShopKart. How can I help you today?` };
}

async function turn(b: Loose): Promise<VoiceTurnResponse> {
  const callId = callIdOf(b);
  const message = str(b, "message", "query", "question", "text", "utterance");
  if (!callId || !message) throw new HttpError(400, "interaction_id and message are required");
  const phone = phoneOf(b);
  const known = await findCall(callId);

  const customer =
    (await findCustomerOrNull(known?.customer_id)) ??
    (await customerByPhone(phone)) ??
    (await customerByAccount(str(b, "account", "order_id", "registered_phone", "email"))) ??
    (await customerByAccount(message)) ??
    (await findCustomerOrNull(DEFAULT_CUSTOMER));

  const turns = (known?.turns ?? 0) + 1;
  if (!customer) {
    await saveCall(callId, { caller_phone: phone ?? known?.caller_phone ?? "", turns, status: "live" });
    return {
      reply: "I couldn't find a ShopKart account for this number. Could you tell me your registered mobile number or one of your order numbers?",
      ticket_id: null,
      customer_id: null,
    };
  }

  const res = await runChat({ session_id: `voice-${callId}`, customer_id: customer.id, message, channel: "voice" }, TURN_TIMEOUT_MS);
  await saveCall(callId, {
    caller_phone: phone ?? known?.caller_phone ?? "",
    customer_id: customer.id,
    ticket_id: res.ticket_id ?? known?.ticket_id ?? null,
    turns,
    status: "live",
  });
  return { reply: speakable(res.reply), ticket_id: res.ticket_id ?? null, customer_id: customer.id };
}

async function callEnded(b: SarvamCallWebhook): Promise<{ ok: true; ticket_id: number | null; duplicate?: true }> {
  if (!b.interaction_id) throw new HttpError(400, "interaction_id is required");
  const known = await findCall(b.interaction_id);
  // Sarvam retries deliveries: the first one did the work.
  if (known?.ended_at) return { ok: true, ticket_id: known.ticket_id, duplicate: true };

  const phone = b.user_phone_number ?? known?.caller_phone ?? "";
  const customer = (await findCustomerOrNull(known?.customer_id)) ?? (await customerByPhone(phone));
  const transcript = (b.interaction_transcript ?? []).filter((t) => t && (t.role === "agent" || t.role === "user"));
  const said = transcript.filter((t) => t.role === "user" && t.en_text?.trim());
  const note = transcriptNote(transcript, phone, b.duration);

  let ticketId = known?.ticket_id ?? null;
  if (ticketId && (await ticketExists(ticketId))) {
    await addComment(ticketId, { public: false, body: note, author: BOT, author_type: "bot" });
  } else if (said.length) {
    // The caller spoke but Aria never acted (no tool call reached /voice/turn): a person should follow up.
    const first = said[0]!.en_text.trim();
    const t = await createTicket({
      subject: `Phone call: ${first.length > 50 ? `${first.slice(0, 47)}…` : first}`,
      comment: said.map((x) => x.en_text.trim()).join("\n"),
      ...(customer ? { requester_id: customer.id } : { requester: { name: `Caller ${phone || "unknown"}`, email: `caller-${last10(phone) || "unknown"}@voice.invalid`, phone } }),
      via: "voice",
      status: "open",
      assignee: null,
      tags: ["voice"],
    });
    await addComment(t.id, { public: false, body: `${note}\n\nAria answered this call but didn't act on it. Needs a person to follow up.`, author: BOT, author_type: "bot" });
    ticketId = t.id;
  } else ticketId = null;

  const ended = b.end_datetime ? new Date(b.end_datetime) : new Date();
  await saveCall(b.interaction_id, {
    status: "ended",
    caller_phone: phone,
    line_phone: b.agent_phone_number ?? known?.line_phone ?? "",
    customer_id: customer?.id ?? null,
    ticket_id: ticketId,
    duration: b.duration ?? null,
    transcript,
    variables: b.output_agent_variables ?? b.final_agent_variables ?? null,
    started_at: known?.started_at ?? (b.start_datetime ? new Date(b.start_datetime) : ended),
    ended_at: ended,
  });
  return { ok: true, ticket_id: ticketId };
}

async function listCalls(limit: number): Promise<VoiceCall[]> {
  const rows = await db
    .select({ call: s.voiceCalls, customer: { id: s.customers.id, name: s.customers.name } })
    .from(s.voiceCalls)
    .leftJoin(s.customers, eq(s.voiceCalls.customer_id, s.customers.id))
    .orderBy(desc(s.voiceCalls.started_at))
    .limit(limit);
  return rows.map((r) => toVoiceCall(r.call, r.customer));
}

async function line(): Promise<VoiceLine> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const stale = new Date(Date.now() - STALE_MS);
  const [[calls], [live], [tickets], [latest], [dialled]] = await Promise.all([
    db.select({ n: count() }).from(s.voiceCalls).where(gte(s.voiceCalls.started_at, today)),
    db.select({ n: count() }).from(s.voiceCalls).where(and(eq(s.voiceCalls.status, "live"), gte(s.voiceCalls.last_activity_at, stale))),
    db.select({ n: count() }).from(s.tickets).where(and(eq(s.tickets.via, "voice"), gte(s.tickets.created_at, today))),
    db.select({ at: s.voiceCalls.last_activity_at }).from(s.voiceCalls).orderBy(desc(s.voiceCalls.last_activity_at)).limit(1),
    // Only the end-of-call webhook says which number was dialled.
    db.select({ line: s.voiceCalls.line_phone }).from(s.voiceCalls).where(ne(s.voiceCalls.line_phone, "")).orderBy(desc(s.voiceCalls.started_at)).limit(1),
  ]);
  return {
    number: NUMBER ?? dialled?.line ?? null,
    public_url: PUBLIC_URL,
    secured: !!SECRET,
    last_seen_at: latest?.at.toISOString() ?? null,
    calls_today: calls?.n ?? 0,
    live: live?.n ?? 0,
    tickets_today: tickets?.n ?? 0,
  };
}

export const voiceRoutes = {
  "/voice/caller": {
    POST: handle(async (req) => {
      authorize(req);
      return ok(await caller(await body<Loose>(req)));
    }),
  },
  "/voice/turn": {
    POST: handle(async (req) => {
      authorize(req);
      return ok(await turn(await body<Loose>(req)));
    }),
  },
  "/voice/calls": {
    GET: handle(async (req) => {
      const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 50));
      return ok({ calls: await listCalls(limit) });
    }),
    POST: handle(async (req) => {
      authorize(req);
      return ok(await callEnded(await body<SarvamCallWebhook>(req)));
    }),
  },
  "/voice/line": {
    GET: handle(async () => ok(await line())),
  },
};

export const voiceMode = `${NUMBER ?? "number not set (VOICE_NUMBER)"} · ${SECRET ? "secured" : "open (set VOICE_WEBHOOK_SECRET)"}${DEFAULT_CUSTOMER ? ` · unknown callers → customer ${DEFAULT_CUSTOMER}` : ""}`;
