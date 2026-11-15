/**
 * Support chats, stored. Every line of a ShopKart chat lands in `chat_messages`, so the shop's chat widget and the
 * Control Room's Chats inbox show the same conversation, and a person can join it:
 *
 * - POST /chat records the customer's message and the answer (agent.ts).
 * - A public reply on a chat's ticket (Aria finishing later, an approval, Kabir in Zendesk) is copied in by
 *   `mirrorComment`, called from `addComment`.
 * - The Control Room writes a person's messages here (POST /control-room/chats/:id/messages). Replying takes the
 *   chat over: its ticket (opened now if it has none) is assigned to that person and Aria stays quiet until they
 *   hand it back or solve it. Meanwhile the customer's messages go straight onto the ticket (`personOnChat`).
 */
import type * as CR from "@ph/shared/controlroom";
import { BOT, OWNER, type ChatAnswer, type ChatMessage, type ChatQuestion, type ChatSender, type ChatTranscript, type ZdComment } from "@ph/shared";
import { and, desc, eq, gt, inArray, ne, schema as s, sql, toChatMessage } from "@ph/db";
import { attachmentsByChatMessage } from "./attachments.ts";
import { db } from "./db.ts";
import { bad, body, handle, notFound, ok } from "./http.ts";
import { addComment, createTicket, updateTicket } from "./zendesk.ts";

/** Aria's name on chat lines. */
export const ARIA = "Aria";

type Row = typeof s.chatMessages.$inferSelect;
type TicketRow = typeof s.tickets.$inferSelect;
export interface ChatRef {
  session_id: string;
  customer_id: number;
  channel_id: string;
}

const isPerson = (assignee: string | null | undefined): assignee is string => !!assignee && assignee !== BOT;

export async function record(
  chat: ChatRef,
  m: { sender: ChatSender; author?: string; body: string; ticket_id?: number | null; ask?: ChatQuestion | null; answer?: ChatAnswer | null },
): Promise<Row> {
  const [row] = await db
    .insert(s.chatMessages)
    .values({ ...chat, sender: m.sender, author: m.author ?? "", body: m.body, ticket_id: m.ticket_id ?? null, ask: m.ask ?? null, answer: m.answer ?? null })
    .returning();
  return row!;
}

/** The chat's newest ticket, if it has one. */
export async function sessionTicket(sessionId: string): Promise<TicketRow | null> {
  const [last] = await db
    .select({ id: s.chatMessages.ticket_id })
    .from(s.chatMessages)
    .where(and(eq(s.chatMessages.session_id, sessionId), sql`${s.chatMessages.ticket_id} is not null`))
    .orderBy(desc(s.chatMessages.ticket_id))
    .limit(1);
  if (!last?.id) return null;
  const [t] = await db.select().from(s.tickets).where(eq(s.tickets.id, last.id));
  return t ?? null;
}

/**
 * The person who owns this chat right now: its newest ticket is unsolved and assigned to someone other than the
 * bot (taken over from the Control Room, or escalated by Aria). Aria doesn't answer over them.
 */
export async function personOnChat(sessionId: string): Promise<{ ticket: TicketRow; agent: string } | null> {
  const t = await sessionTicket(sessionId);
  return t && t.status !== "solved" && isPerson(t.assignee) ? { ticket: t, agent: t.assignee } : null;
}

/** True when a person wrote in this chat in the last half hour: they're talking with the customer live. */
export async function personActive(sessionId: string): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 60_000);
  const [row] = await db
    .select({ id: s.chatMessages.id })
    .from(s.chatMessages)
    .where(and(eq(s.chatMessages.session_id, sessionId), eq(s.chatMessages.sender, "human"), gt(s.chatMessages.created_at, since)))
    .limit(1);
  return !!row;
}

/** The first time a chat meets a ticket, the customer sees a notice, as the widget always showed. */
export async function linkTicket(chat: ChatRef, ticketId: number) {
  const [seen] = await db
    .select({ id: s.chatMessages.id })
    .from(s.chatMessages)
    .where(and(eq(s.chatMessages.session_id, chat.session_id), eq(s.chatMessages.ticket_id, ticketId)))
    .limit(1);
  if (!seen) await record(chat, { sender: "system", body: `Ticket #${ticketId} opened with ShopKart support`, ticket_id: ticketId });
}

/**
 * Records Aria's answer once. The same text can arrive twice for one turn: as the /chat response and as the public
 * comment the agent posted on the ticket while answering. Anything Aria already said since the customer last wrote
 * counts as said.
 */
export async function recordAria(chat: ChatRef, text: string, extra: { ticket_id?: number | null; ask?: ChatQuestion | null } = {}) {
  const body = text.trim();
  if (!body) return;
  const [lastCustomer] = await db
    .select({ id: s.chatMessages.id })
    .from(s.chatMessages)
    .where(and(eq(s.chatMessages.session_id, chat.session_id), eq(s.chatMessages.sender, "customer")))
    .orderBy(desc(s.chatMessages.id))
    .limit(1);
  const [dupe] = await db
    .select({ id: s.chatMessages.id })
    .from(s.chatMessages)
    .where(and(eq(s.chatMessages.session_id, chat.session_id), eq(s.chatMessages.sender, "ai"), eq(s.chatMessages.body, body), gt(s.chatMessages.id, lastCustomer?.id ?? 0)))
    .limit(1);
  if (dupe) {
    if (extra.ask) await db.update(s.chatMessages).set({ ask: extra.ask }).where(eq(s.chatMessages.id, dupe.id));
    return;
  }
  await record(chat, { sender: "ai", author: ARIA, body, ticket_id: extra.ticket_id ?? null, ask: extra.ask ?? null });
}

/** The chat a ticket belongs to: the newest session that has messages and was tied to it by a chat, a run or the stand-in. */
export async function chatOfTicket(ticketId: number): Promise<ChatRef | null> {
  const [row] = await db
    .select({ session_id: s.chatMessages.session_id, customer_id: s.chatMessages.customer_id, channel_id: s.chatMessages.channel_id })
    .from(s.chatMessages)
    .where(
      sql`${s.chatMessages.session_id} in (
        select session_id from chat_messages where ticket_id = ${ticketId}
        union select session_id from rai_runs where ticket_id = ${ticketId}
        union select session_id from chat_sessions where ticket_id = ${ticketId})`,
    )
    .orderBy(desc(s.chatMessages.id))
    .limit(1);
  return row ?? null;
}

/** A public reply on a chat's ticket shows in the chat: Aria's later answers, an approval, a person replying in Zendesk. */
export async function mirrorComment(ticketId: number, c: ZdComment) {
  if (!c.public || c.author_type === "customer") return;
  const chat = await chatOfTicket(ticketId);
  if (!chat) return;
  await linkTicket(chat, ticketId);
  if (c.author_type === "bot") return recordAria(chat, c.body, { ticket_id: ticketId });
  await record(chat, { sender: "human", author: c.author, body: c.body, ticket_id: ticketId });
}

/**
 * Aria's answer as the agent saved it on its run. Usually /chat records the same text a moment later (deduped);
 * this keeps the chat whole when that response never makes it back, e.g. the connection dropped mid-request.
 */
export async function mirrorRunReply(run: { session_id: string; ticket_id: number | null; reply: string | null }) {
  if (!run.reply?.trim()) return;
  const [chat] = await db
    .select({ session_id: s.chatMessages.session_id, customer_id: s.chatMessages.customer_id, channel_id: s.chatMessages.channel_id })
    .from(s.chatMessages)
    .where(eq(s.chatMessages.session_id, run.session_id))
    .limit(1);
  if (!chat) return;
  if (run.ticket_id) await linkTicket(chat, run.ticket_id);
  await recordAria(chat, run.reply, { ticket_id: run.ticket_id });
}

/* ───── Reads ───── */

async function messagesOf(sessionId: string): Promise<ChatMessage[]> {
  const [rows, photos] = await Promise.all([
    db.select().from(s.chatMessages).where(eq(s.chatMessages.session_id, sessionId)).orderBy(s.chatMessages.id),
    attachmentsByChatMessage([sessionId]),
  ]);
  return rows.map((r) => ({ ...toChatMessage(r), ...(photos.has(r.id) && { attachments: photos.get(r.id) }) }));
}

async function transcript(sessionId: string): Promise<ChatTranscript> {
  const [messages, ticket] = await Promise.all([messagesOf(sessionId), sessionTicket(sessionId)]);
  const person = ticket && ticket.status !== "solved" && isPerson(ticket.assignee) ? ticket.assignee : null;
  return { session_id: sessionId, messages, handler: person ? "human" : "ai", agent: person, ticket_id: ticket?.id ?? null };
}

/** "+91 90000 10101" → "+91 90•••• 0101", else the email. Same masking as the rest of the Control Room. */
function maskedContact(phone: string, email: string): string {
  const compact = phone.replace(/[^\d+]/g, "");
  const cc = compact.startsWith("+91") ? "+91" : compact.startsWith("+") ? compact.slice(0, 3) : "";
  const national = compact.slice(cc.length).replace(/\D/g, "");
  if (national.length < 6) return email;
  return `${cc ? `${cc} ` : ""}${national.slice(0, 2)}•••• ${national.slice(-4)}`;
}

/** The inbox rows, newest activity first. Three batched rounds, whatever the number of chats. */
async function threads(only?: string): Promise<CR.ChatThread[]> {
  const where = only ? eq(s.chatMessages.session_id, only) : gt(s.chatMessages.created_at, new Date(Date.now() - 30 * 86_400_000));
  const [stats, latest] = await Promise.all([
    db
      .select({
        session_id: s.chatMessages.session_id,
        customer_id: sql<number>`min(${s.chatMessages.customer_id})`,
        channel_id: sql<string>`min(${s.chatMessages.channel_id})`,
        count: sql<number>`count(*) filter (where ${s.chatMessages.sender} <> 'system')`.mapWith(Number),
        started: sql<Date>`min(${s.chatMessages.created_at})`.mapWith((v) => new Date(v)),
        updated: sql<Date>`max(${s.chatMessages.created_at})`.mapWith((v) => new Date(v)),
        ticket_id: sql<number | null>`max(${s.chatMessages.ticket_id})`,
      })
      .from(s.chatMessages)
      .where(where)
      .groupBy(s.chatMessages.session_id),
    db
      .selectDistinctOn([s.chatMessages.session_id])
      .from(s.chatMessages)
      .where(and(where, ne(s.chatMessages.sender, "system")))
      .orderBy(s.chatMessages.session_id, desc(s.chatMessages.id)),
  ]);
  if (!stats.length) return [];
  const ticketIds = [...new Set(stats.flatMap((r) => (r.ticket_id ? [Number(r.ticket_id)] : [])))];
  const customerIds = [...new Set(stats.map((r) => Number(r.customer_id)))];
  const [tickets, customers, channels] = await Promise.all([
    ticketIds.length ? db.select().from(s.tickets).where(inArray(s.tickets.id, ticketIds)) : [],
    db.select().from(s.customers).where(inArray(s.customers.id, customerIds)),
    db.select({ id: s.channels.id, kind: s.channels.kind }).from(s.channels),
  ]);
  const ticketOf = new Map(tickets.map((t) => [t.id, t]));
  const customerOf = new Map(customers.map((c) => [c.id, c]));
  const kindOf = new Map(channels.map((c) => [c.id, c.kind as CR.ChannelId]));
  const lastOf = new Map(latest.map((m) => [m.session_id, m]));

  return stats
    .map((r): CR.ChatThread => {
      const who = customerOf.get(Number(r.customer_id));
      const t = r.ticket_id ? ticketOf.get(Number(r.ticket_id)) : undefined;
      const last = lastOf.get(r.session_id);
      const person = t && t.status !== "solved" && isPerson(t.assignee) ? t.assignee : null;
      return {
        id: r.session_id,
        customer: who
          ? { id: who.id, name: who.name, contact: maskedContact(who.phone, who.email), city: who.city }
          : { id: Number(r.customer_id), name: `Customer ${r.customer_id}`, contact: "", city: "" },
        channel: kindOf.get(r.channel_id) ?? "chat",
        last: last ? { sender: last.sender, author: last.author, body: last.body, at: last.created_at.toISOString() } : null,
        startedAt: r.started.toISOString(),
        updatedAt: r.updated.toISOString(),
        count: r.count,
        ticket: t ? { id: t.id, status: t.status, assignee: t.assignee, subject: t.subject } : null,
        handler: person ? "human" : "ai",
        agent: person,
        waiting: !!person && last?.sender === "customer",
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function detail(sessionId: string): Promise<CR.ChatDetail> {
  const [[chat], messages] = await Promise.all([threads(sessionId), messagesOf(sessionId)]);
  if (!chat) throw notFound(`Chat ${sessionId}`);
  return { chat, messages };
}

async function chatRef(sessionId: string): Promise<ChatRef> {
  const [row] = await db
    .select({ session_id: s.chatMessages.session_id, customer_id: s.chatMessages.customer_id, channel_id: s.chatMessages.channel_id })
    .from(s.chatMessages)
    .where(eq(s.chatMessages.session_id, sessionId))
    .limit(1);
  if (!row) throw notFound(`Chat ${sessionId}`);
  return row;
}

/* ───── A person joins ───── */

/**
 * Opens a ticket for a chat that has none (or only a solved one), with the chat so far since its last ticket
 * copied on, so Zendesk shows the whole conversation. Assigned to the person who joined.
 */
async function openTicketFor(chat: ChatRef, agent: string, after: number): Promise<TicketRow> {
  const rows = await db
    .select()
    .from(s.chatMessages)
    .where(and(eq(s.chatMessages.session_id, chat.session_id), gt(s.chatMessages.id, after), ne(s.chatMessages.sender, "system")))
    .orderBy(s.chatMessages.id);
  const [customer] = await db.select().from(s.zdUsers).where(eq(s.zdUsers.id, chat.customer_id));
  const first = rows.find((m) => m.sender === "customer")?.body;
  const subject = first ? (first.length > 60 ? `${first.slice(0, 57)}…` : first) : `Chat with ${customer?.name ?? `customer ${chat.customer_id}`}`;
  const ticket = await createTicket({
    subject,
    requester_id: chat.customer_id,
    via: "chat",
    assignee: agent,
    status: "open",
    type: "question",
    priority: "normal",
    tags: ["chat", "live-chat"],
  });
  if (rows.length) {
    await db.insert(s.ticketComments).values(
      rows.map((m) => ({
        ticket_id: ticket.id,
        author: m.sender === "customer" ? (customer?.name ?? m.author) : m.sender === "ai" ? BOT : m.author,
        author_type: m.sender === "customer" ? ("customer" as const) : m.sender === "ai" ? ("bot" as const) : ("agent" as const),
        body: m.body,
        public: true,
        created_at: m.created_at,
      })),
    );
    await db.update(s.chatMessages).set({ ticket_id: ticket.id }).where(inArray(s.chatMessages.id, rows.map((m) => m.id)));
  }
  await record(chat, { sender: "system", body: `Ticket #${ticket.id} opened with ShopKart support`, ticket_id: ticket.id });
  await Promise.all([
    addComment(ticket.id, { public: false, author: agent, body: `${agent} joined this chat from the ResolveAI Control Room and took it over from Aria.` }),
    // The stand-in agent finds a chat's ticket here.
    db.insert(s.chatSessions).values({ session_id: chat.session_id, ticket_id: ticket.id }).onConflictDoUpdate({ target: s.chatSessions.session_id, set: { ticket_id: ticket.id } }),
  ]);
  const [row] = await db.select().from(s.tickets).where(eq(s.tickets.id, ticket.id));
  return row!;
}

/** A person's message from the Control Room. The first one takes the chat over from Aria. */
async function personSays(sessionId: string, text: string, agent: string = OWNER.name) {
  const msg = text.trim();
  if (!msg) throw bad("Write a message first");
  if (msg.length > 4000) throw bad("That message is too long (4,000 characters at most)");
  const chat = await chatRef(sessionId);
  let ticket = await sessionTicket(sessionId);
  if (!ticket || ticket.status === "solved") {
    const [lastTicketed] = await db
      .select({ id: s.chatMessages.id })
      .from(s.chatMessages)
      .where(and(eq(s.chatMessages.session_id, sessionId), sql`${s.chatMessages.ticket_id} is not null`))
      .orderBy(desc(s.chatMessages.id))
      .limit(1);
    ticket = await openTicketFor(chat, agent, lastTicketed?.id ?? 0);
  } else if (ticket.assignee !== agent) {
    await updateTicket(ticket.id, { assignee: agent, handled_by: "human", status: "open", actor: "human" });
    await addComment(ticket.id, { public: false, author: agent, body: `${agent} took this chat over from ${ticket.assignee === BOT ? "Aria" : (ticket.assignee ?? "the queue")} in the ResolveAI Control Room.` });
  }
  const [joined] = await db
    .select({ id: s.chatMessages.id })
    .from(s.chatMessages)
    .where(and(eq(s.chatMessages.session_id, sessionId), eq(s.chatMessages.ticket_id, ticket.id), eq(s.chatMessages.sender, "human")))
    .limit(1);
  if (!joined) await record(chat, { sender: "system", body: `${agent} from ShopKart joined the chat`, ticket_id: ticket.id });
  // Posted as a public Zendesk reply; mirrorComment puts it in the chat.
  await addComment(ticket.id, { public: true, author: agent, author_type: "agent", body: msg });
}

async function handBack(sessionId: string, agent: string = OWNER.name) {
  const chat = await chatRef(sessionId);
  const owner = await personOnChat(sessionId);
  if (!owner) throw bad("Aria is already answering this chat");
  const { ticket } = owner;
  const handled = ticket.level && ticket.level !== "critical" ? ticket.level : null;
  await updateTicket(ticket.id, { assignee: BOT, handled_by: handled, actor: "human" });
  await addComment(ticket.id, { public: false, author: agent, body: `${agent} handed this chat back to ResolveAI from the Control Room.` });
  await record(chat, { sender: "system", body: `${agent.split(" ")[0]} handed the chat back to Aria`, ticket_id: ticket.id });
}

async function solve(sessionId: string, agent: string = OWNER.name) {
  const chat = await chatRef(sessionId);
  const ticket = await sessionTicket(sessionId);
  if (!ticket || ticket.status === "solved") throw bad("This chat has no open ticket to solve");
  await updateTicket(ticket.id, { status: "solved", actor: "human" });
  await record(chat, { sender: "system", body: `Ticket #${ticket.id} solved by ${agent.split(" ")[0]}`, ticket_id: ticket.id });
}

/* ───── Routes ───── */

const sessionParam = (id: string | undefined) => {
  if (!id?.trim()) throw bad("Chat id is required");
  return decodeURIComponent(id);
};

export const chatRoutes = {
  /** The shop's chat widget loads and polls its conversation here. */
  "/chat/sessions/:id": {
    GET: handle(async (req) => ok(await transcript(sessionParam(req.params.id)))),
  },
  "/control-room/chats": {
    GET: handle(async () => ok({ chats: await threads() })),
  },
  "/control-room/chats/:id": {
    GET: handle(async (req) => ok(await detail(sessionParam(req.params.id)))),
  },
  "/control-room/chats/:id/messages": {
    POST: handle(async (req) => {
      const b = await body<{ body?: string }>(req);
      await personSays(sessionParam(req.params.id), String(b.body ?? ""));
      return ok(await detail(sessionParam(req.params.id)), 201);
    }),
  },
  "/control-room/chats/:id/handback": {
    POST: handle(async (req) => {
      await handBack(sessionParam(req.params.id));
      return ok(await detail(sessionParam(req.params.id)));
    }),
  },
  "/control-room/chats/:id/solve": {
    POST: handle(async (req) => {
      await solve(sessionParam(req.params.id));
      return ok(await detail(sessionParam(req.params.id)));
    }),
  },
};
