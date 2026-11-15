import {
  BOT,
  LEVEL_TO_PRIORITY,
  type AgentLevel,
  type CreateCommentBody,
  type CreateTicketBody,
  type Ticket,
  type TicketPriority,
  type TicketSummary,
  type TicketView,
  type UpdateTicketBody,
  type ZdComment,
  type ZdUser,
} from "@ph/shared";
import { eq, schema as s, sql, toComment, toTicket, toTicketSummary, toZdUser, type Tx } from "@ph/db";
import { db } from "./db.ts";
import { bad, body, handle, intParam, notFound, ok, oneOf } from "./http.ts";

const STATUSES = ["new", "open", "pending", "solved"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TYPES = ["question", "incident", "problem"] as const;
const VIEWS = ["all_unsolved", "unassigned", "assigned_humans", "recently_solved"] as const;

export function toPriority(v: unknown): TicketPriority {
  if (typeof v === "string" && v in LEVEL_TO_PRIORITY) return LEVEL_TO_PRIORITY[v as AgentLevel];
  return oneOf(v, PRIORITIES, "priority");
}

export async function findTicket(id: number, tx: Tx = db): Promise<Ticket> {
  const row = await tx.query.tickets.findFirst({ where: eq(s.tickets.id, id), with: { requester: true, comments: true } });
  if (!row) throw notFound(`Ticket #${id}`);
  return toTicket(row);
}

export async function ticketExists(id: number): Promise<boolean> {
  return (await db.select({ id: s.tickets.id }).from(s.tickets).where(eq(s.tickets.id, id))).length > 0;
}

/** Every ticket without its comments, plus the comment count. */
async function summaries(where?: ReturnType<typeof eq>): Promise<TicketSummary[]> {
  const rows = await db
    .select({
      ticket: s.tickets,
      requester: s.zdUsers,
      comment_count: sql<number>`(select count(*)::int from ${s.ticketComments} where ${s.ticketComments.ticket_id} = ${s.tickets.id})`,
    })
    .from(s.tickets)
    .innerJoin(s.zdUsers, eq(s.tickets.requester_id, s.zdUsers.id))
    .where(where);
  return rows.map((r) => toTicketSummary({ ...r.ticket, requester: r.requester }, r.comment_count));
}

function inView(t: TicketSummary, view: TicketView): boolean {
  switch (view) {
    case "all_unsolved":
      return t.status !== "solved";
    case "unassigned":
      return t.status !== "solved" && !t.assignee;
    case "assigned_humans":
      return t.status !== "solved" && !!t.assignee && t.assignee !== BOT;
    case "recently_solved":
      return t.status === "solved";
  }
}

async function resolveRequester(tx: Tx, b: CreateTicketBody): Promise<ZdUser> {
  if (b.requester_id !== undefined) {
    const [user] = await tx.select().from(s.zdUsers).where(eq(s.zdUsers.id, b.requester_id));
    if (!user) throw bad(`No requester with id ${b.requester_id}`);
    return toZdUser(user);
  }
  if (b.requester?.email) {
    const email = b.requester.email.trim();
    const [existing] = await tx.select().from(s.zdUsers).where(sql`lower(${s.zdUsers.email}) = ${email.toLowerCase()}`);
    if (existing) return toZdUser(existing);
    const [user] = await tx.insert(s.zdUsers).values({ name: b.requester.name, email, phone: b.requester.phone ?? "" }).returning();
    return toZdUser(user!);
  }
  throw bad("Send requester_id, or requester { name, email, phone }");
}

/* ───── Operations (also used by the built-in chat simulator) ───── */

export async function createTicket(b: CreateTicketBody): Promise<Ticket> {
  if (!b.subject?.trim()) throw bad("subject is required");
  return db.transaction(async (tx) => {
    const requester = await resolveRequester(tx, b);
    const at = new Date();
    const [row] = await tx
      .insert(s.tickets)
      .values({
        subject: b.subject.trim(),
        status: b.status ? oneOf(b.status, STATUSES, "status") : "new",
        priority: b.priority ? toPriority(b.priority) : "normal",
        type: b.type ? oneOf(b.type, TYPES, "type") : "question",
        requester_id: requester.id,
        assignee: b.assignee ?? null,
        tags: b.tags ?? [],
        via: b.via ?? "api",
        order_id: b.order_id ?? null,
        created_at: at,
        updated_at: at,
      })
      .returning({ id: s.tickets.id });
    if (b.comment?.trim()) {
      await tx.insert(s.ticketComments).values({ ticket_id: row!.id, author: requester.name, author_type: "customer", body: b.comment.trim(), public: true, created_at: at });
    }
    return findTicket(row!.id, tx);
  });
}

export async function updateTicket(id: number, b: UpdateTicketBody): Promise<Ticket> {
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(s.tickets).where(eq(s.tickets.id, id)).for("update");
    if (!t) throw notFound(`Ticket #${id}`);
    const next: Partial<typeof s.tickets.$inferInsert> = { updated_at: new Date() };
    if (b.subject !== undefined) {
      if (!b.subject.trim()) throw bad("subject can't be empty");
      next.subject = b.subject.trim();
    }
    if (b.status !== undefined) next.status = oneOf(b.status, STATUSES, "status");
    if (b.priority !== undefined) next.priority = toPriority(b.priority);
    if (b.type !== undefined) next.type = oneOf(b.type, TYPES, "type");
    if (b.tags !== undefined) next.tags = b.tags;
    if (b.csat !== undefined) next.csat = b.csat;
    let escalated = t.escalated_by_ai;
    if (b.assignee !== undefined && b.assignee !== t.assignee) {
      // The bot handing its own ticket to a person counts as an AI escalation,
      // unless a human made the change from the UI.
      const handedOff = t.assignee === BOT && b.assignee !== null && b.assignee !== BOT && b.actor !== "human";
      next.assignee = b.assignee;
      if (handedOff) escalated = true;
      if (b.assignee === BOT || b.assignee === null) escalated = false;
    }
    if (b.escalated_by_ai !== undefined) escalated = b.escalated_by_ai;
    next.escalated_by_ai = escalated;
    const assignee = next.assignee !== undefined ? next.assignee : t.assignee;
    if (t.status === "new" && assignee && b.status === undefined) next.status = "open";
    await tx.update(s.tickets).set(next).where(eq(s.tickets.id, id));
    return findTicket(id, tx);
  });
}

export async function addComment(id: number, b: CreateCommentBody): Promise<ZdComment> {
  if (!b.body?.trim()) throw bad("body is required");
  if (typeof b.public !== "boolean") throw bad("public must be true (reply) or false (internal note)");
  return db.transaction(async (tx) => {
    const [t] = await tx
      .select({ id: s.tickets.id, requester: s.zdUsers.name })
      .from(s.tickets)
      .innerJoin(s.zdUsers, eq(s.tickets.requester_id, s.zdUsers.id))
      .where(eq(s.tickets.id, id));
    if (!t) throw notFound(`Ticket #${id}`);
    const author = b.author ?? BOT;
    const at = new Date();
    const [row] = await tx
      .insert(s.ticketComments)
      .values({
        ticket_id: id,
        author,
        author_type: b.author_type ?? (author === BOT ? "bot" : author === t.requester ? "customer" : "agent"),
        body: b.body.trim(),
        public: b.public,
        created_at: at,
      })
      .returning();
    await tx.update(s.tickets).set({ updated_at: at }).where(eq(s.tickets.id, id));
    return toComment(row!);
  });
}

/* ───── Routes ───── */

export const zendeskRoutes = {
  "/zendesk/tickets": {
    GET: handle(async (req) => {
      const raw = new URL(req.url).searchParams.get("view") ?? "all_unsolved";
      const view = oneOf(raw, VIEWS, "view");
      const all = await summaries();
      const counts = Object.fromEntries(VIEWS.map((v) => [v, all.filter((t) => inView(t, v)).length]));
      const tickets = all
        .filter((t) => inView(t, view))
        .sort((a, b) => (view === "recently_solved" ? b.updated_at.localeCompare(a.updated_at) : b.id - a.id));
      // Newest tickets regardless of view, so the UI can announce arrivals it isn't showing.
      const recent = [...all].sort((a, b) => b.id - a.id).slice(0, 5);
      return ok({ view, counts, tickets, recent });
    }),
    POST: handle(async (req) => ok(await createTicket(await body<CreateTicketBody>(req)), 201)),
  },
  "/zendesk/tickets/:id": {
    GET: handle(async (req) => ok(await findTicket(intParam(req.params.id, "Ticket id")))),
    PATCH: handle(async (req) => ok(await updateTicket(intParam(req.params.id, "Ticket id"), await body<UpdateTicketBody>(req)))),
  },
  "/zendesk/tickets/:id/comments": {
    POST: handle(async (req) => ok(await addComment(intParam(req.params.id, "Ticket id"), await body<CreateCommentBody>(req)), 201)),
  },
  "/zendesk/users/:id/tickets": {
    GET: handle(async (req) => {
      const id = intParam(req.params.id, "User id");
      const [user] = await db.select().from(s.zdUsers).where(eq(s.zdUsers.id, id));
      if (!user) throw notFound(`User ${id}`);
      const tickets = (await summaries(eq(s.tickets.requester_id, id))).sort((a, b) => b.id - a.id);
      return ok({ user: toZdUser(user), tickets });
    }),
  },
  "/zendesk/agents": {
    GET: handle(() => ok({ agents: [BOT, "Priya – Support", "Karan – Support"] })),
  },
};
