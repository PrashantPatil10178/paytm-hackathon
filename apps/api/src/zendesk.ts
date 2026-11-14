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
import { db } from "./db.ts";
import { bad, body, handle, intParam, notFound, now, ok, oneOf } from "./http.ts";

const STATUSES = ["new", "open", "pending", "solved"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TYPES = ["question", "incident", "problem"] as const;
const VIEWS = ["all_unsolved", "unassigned", "assigned_humans", "recently_solved"] as const;

export function toPriority(v: unknown): TicketPriority {
  if (typeof v === "string" && v in LEVEL_TO_PRIORITY) return LEVEL_TO_PRIORITY[v as AgentLevel];
  return oneOf(v, PRIORITIES, "priority");
}

const summary = ({ comments, ...t }: Ticket): TicketSummary => ({ ...t, comment_count: comments.length });

export function findTicket(id: number): Ticket {
  const t = db.tickets.find((x) => x.id === id);
  if (!t) throw notFound(`Ticket #${id}`);
  return t;
}

function inView(t: Ticket, view: TicketView): boolean {
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

function resolveRequester(b: CreateTicketBody): ZdUser {
  if (b.requester_id !== undefined) {
    const user = db.zdUsers.find((x) => x.id === b.requester_id);
    if (!user) throw bad(`No requester with id ${b.requester_id}`);
    return user;
  }
  if (b.requester?.email) {
    const existing = db.zdUsers.find((x) => x.email.toLowerCase() === b.requester!.email.toLowerCase());
    if (existing) return existing;
    const user: ZdUser = { id: ++db.seq.user, name: b.requester.name, email: b.requester.email, phone: b.requester.phone ?? "" };
    db.zdUsers.push(user);
    return user;
  }
  throw bad("Send requester_id, or requester { name, email, phone }");
}

/* ───── Operations (also used by the built-in chat simulator) ───── */

export function createTicket(b: CreateTicketBody): Ticket {
  if (!b.subject?.trim()) throw bad("subject is required");
  const requester = resolveRequester(b);
  const at = now();
  const ticket: Ticket = {
    id: ++db.seq.ticket,
    subject: b.subject.trim(),
    status: b.status ? oneOf(b.status, STATUSES, "status") : "new",
    priority: b.priority ? toPriority(b.priority) : "normal",
    type: b.type ? oneOf(b.type, TYPES, "type") : "question",
    requester,
    assignee: b.assignee ?? null,
    escalated_by_ai: false,
    tags: b.tags ?? [],
    via: b.via ?? "api",
    order_id: b.order_id ?? null,
    csat: null,
    created_at: at,
    updated_at: at,
    comments: [],
  };
  if (b.comment?.trim()) {
    ticket.comments.push({ id: ++db.seq.comment, author: requester.name, author_type: "customer", body: b.comment.trim(), public: true, created_at: at });
  }
  db.tickets.push(ticket);
  return ticket;
}

export function updateTicket(id: number, b: UpdateTicketBody): Ticket {
  const t = findTicket(id);
  if (b.status !== undefined) t.status = oneOf(b.status, STATUSES, "status");
  if (b.priority !== undefined) t.priority = toPriority(b.priority);
  if (b.type !== undefined) t.type = oneOf(b.type, TYPES, "type");
  if (b.tags !== undefined) t.tags = b.tags;
  if (b.csat !== undefined) t.csat = b.csat;
  if (b.assignee !== undefined && b.assignee !== t.assignee) {
    // The bot handing its own ticket to a person counts as an AI escalation,
    // unless a human made the change from the UI.
    const handedOff = t.assignee === BOT && b.assignee !== null && b.assignee !== BOT && b.actor !== "human";
    t.assignee = b.assignee;
    if (handedOff) t.escalated_by_ai = true;
    if (b.assignee === BOT || b.assignee === null) t.escalated_by_ai = false;
  }
  if (b.escalated_by_ai !== undefined) t.escalated_by_ai = b.escalated_by_ai;
  if (t.status === "new" && t.assignee && b.status === undefined) t.status = "open";
  t.updated_at = now();
  return t;
}

export function addComment(id: number, b: CreateCommentBody): ZdComment {
  const t = findTicket(id);
  if (!b.body?.trim()) throw bad("body is required");
  if (typeof b.public !== "boolean") throw bad("public must be true (reply) or false (internal note)");
  const author = b.author ?? BOT;
  const comment: ZdComment = {
    id: ++db.seq.comment,
    author,
    author_type: b.author_type ?? (author === BOT ? "bot" : author === t.requester.name ? "customer" : "agent"),
    body: b.body.trim(),
    public: b.public,
    created_at: now(),
  };
  t.comments.push(comment);
  t.updated_at = comment.created_at;
  return comment;
}

/* ───── Routes ───── */

export const zendeskRoutes = {
  "/zendesk/tickets": {
    GET: handle((req) => {
      const raw = new URL(req.url).searchParams.get("view") ?? "all_unsolved";
      const view = oneOf(raw, VIEWS, "view");
      const counts = Object.fromEntries(VIEWS.map((v) => [v, db.tickets.filter((t) => inView(t, v)).length]));
      const tickets = db.tickets
        .filter((t) => inView(t, view))
        .sort((a, b) => (view === "recently_solved" ? b.updated_at.localeCompare(a.updated_at) : b.id - a.id))
        .map(summary);
      // Newest tickets regardless of view, so the UI can announce arrivals it isn't showing.
      const recent = [...db.tickets].sort((a, b) => b.id - a.id).slice(0, 5).map(summary);
      return ok({ view, counts, tickets, recent });
    }),
    POST: handle(async (req) => ok(createTicket(await body<CreateTicketBody>(req)), 201)),
  },
  "/zendesk/tickets/:id": {
    GET: handle((req) => ok(findTicket(intParam(req.params.id, "Ticket id")))),
    PATCH: handle(async (req) => ok(updateTicket(intParam(req.params.id, "Ticket id"), await body<UpdateTicketBody>(req)))),
  },
  "/zendesk/tickets/:id/comments": {
    POST: handle(async (req) => ok(addComment(intParam(req.params.id, "Ticket id"), await body<CreateCommentBody>(req)), 201)),
  },
  "/zendesk/users/:id/tickets": {
    GET: handle((req) => {
      const id = intParam(req.params.id, "User id");
      const user = db.zdUsers.find((x) => x.id === id);
      if (!user) throw notFound(`User ${id}`);
      const tickets = db.tickets.filter((t) => t.requester.id === id).sort((a, b) => b.id - a.id).map(summary);
      return ok({ user, tickets });
    }),
  },
  "/zendesk/agents": {
    GET: handle(() => ok({ agents: [BOT, "Priya – Support", "Karan – Support"] })),
  },
};
