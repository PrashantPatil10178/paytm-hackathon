/**
 * Request forms: the details a customer is asked for in the ShopKart chat (which order, what went wrong, a photo).
 *
 *   GET   /info/forms                 the forms the team set up (Control Room › Request forms)
 *   PATCH /info/forms/:id             switch a form or its fields on/off, edit what it says
 *   GET   /info/requests              forms sent into chats (?ticket_id=, ?status=)
 *   POST  /info/requests              send one: Aria (the support agent's request_details tool) or a person
 *   POST  /info/requests/:id/answer   the customer's answers, from the chat
 *   POST  /info/requests/:id/withdraw a person takes a waiting form back
 *
 * Aria may only send an active form; a person can send any. The order choices are the customer's own orders at
 * the moment the form goes out, so the answer can only name one of them.
 */
import {
  BOT,
  rupees,
  type AnswerInfoRequestBody,
  type AnswerInfoRequestResponse,
  type CreateInfoRequestBody,
  type InfoAnswer,
  type InfoChoice,
  type InfoForm,
  type InfoRequest,
  type InfoRequestField,
  type InfoRequestStatus,
  type Order,
  type UpdateInfoFormBody,
} from "@ph/shared";
import { and, asc, desc, eq, schema as s, toInfoForm, toInfoRequest } from "@ph/db";
import { db } from "./db.ts";
import { bad, body, handle, HttpError, intParam, notFound, ok, oneOf } from "./http.ts";
import { customerOrders } from "./shop.ts";
import { addComment, findTicket, updateTicket } from "./zendesk.ts";

/** A phone photo, shrunk in the browser before upload, stays well under this (as a data: URL). */
const MAX_PHOTO_CHARS = 700_000;
const MAX_TEXT = 500;
const ORDER_CHOICES = 6;
const STATUSES = ["waiting", "answered", "withdrawn"] as const;

const ORDER_STATUS: Record<Order["status"], string> = { placed: "Placed", shipped: "On the way", delivered: "Delivered", damaged: "Reported damaged" };

const itemsText = (o: Order) => o.items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(", ");

const orderChoice = (o: Order): InfoChoice => ({
  value: String(o.id),
  label: itemsText(o),
  detail: `#${o.id} · ${rupees(o.amount)} · ${ORDER_STATUS[o.status]}`,
  ...(o.items[0]?.image && { image: o.items[0].image }),
});

/* ───── Forms ───── */

export async function listForms(): Promise<InfoForm[]> {
  return (await db.select().from(s.infoForms).orderBy(asc(s.infoForms.position))).map(toInfoForm);
}

async function findForm(id: string): Promise<InfoForm> {
  const [row] = await db.select().from(s.infoForms).where(eq(s.infoForms.id, id));
  if (!row) throw notFound(`Form "${id}"`);
  return toInfoForm(row);
}

async function updateForm(id: string, b: UpdateInfoFormBody): Promise<InfoForm> {
  const form = await findForm(id);
  const next: Partial<typeof s.infoForms.$inferInsert> = { updated_at: new Date() };
  if (b.ask !== undefined) {
    if (!b.ask.trim() || b.ask.length > 240) throw bad("ask must be 1–240 characters");
    next.ask = b.ask.trim();
  }
  if (b.use_for !== undefined) {
    if (!b.use_for.trim() || b.use_for.length > 300) throw bad("use_for must be 1–300 characters");
    next.use_for = b.use_for.trim();
  }
  if (b.active !== undefined) next.active = Boolean(b.active);
  if (b.fields !== undefined) {
    if (!Array.isArray(b.fields)) throw bad("fields must be a list of { key, enabled?, required? }");
    const fields = form.fields.map((f) => ({ ...f }));
    for (const change of b.fields) {
      const f = fields.find((x) => x.key === change?.key);
      if (!f) throw bad(`The "${form.title}" form has no field "${change?.key}"`);
      if (change.enabled !== undefined) f.enabled = Boolean(change.enabled);
      if (change.required !== undefined) f.required = Boolean(change.required);
    }
    if (!fields.some((f) => f.enabled)) throw bad("A form needs at least one field switched on");
    next.fields = fields;
  }
  await db.update(s.infoForms).set(next).where(eq(s.infoForms.id, id));
  return findForm(id);
}

/* ───── Requests ───── */

async function requestRows(where: Parameters<typeof and>, limit = 50): Promise<InfoRequest[]> {
  const rows = await db
    .select({ r: s.infoRequests, customer: { id: s.customers.id, name: s.customers.name } })
    .from(s.infoRequests)
    .leftJoin(s.customers, eq(s.infoRequests.customer_id, s.customers.id))
    .where(and(...where))
    .orderBy(desc(s.infoRequests.id))
    .limit(limit);
  return rows.map(({ r, customer }) => toInfoRequest(r, customer?.id != null ? customer : null));
}

async function findRequest(id: number): Promise<InfoRequest> {
  const [r] = await requestRows([eq(s.infoRequests.id, id)], 1);
  if (!r) throw notFound(`Request ${id}`);
  return r;
}

export async function createInfoRequest(b: CreateInfoRequestBody): Promise<InfoRequest> {
  const ticketId = intParam(String(b.ticket_id ?? ""), "ticket_id");
  if (typeof b.form_id !== "string" || !b.form_id) throw bad("form_id is required");
  const [ticket, form] = await Promise.all([findTicket(ticketId), findForm(b.form_id)]);
  const by = b.requested_by?.trim() || BOT;
  if (by === BOT && !form.active) throw new HttpError(409, `Aria can't send the "${form.title}" form: it's switched off in the Control Room`);

  // ShopKart customers are also Zendesk users with the same id.
  const [customer] = await db.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(eq(s.customers.id, ticket.requester.id));
  const enabled = form.fields.filter((f) => f.enabled);
  let orders: Order[] = [];
  if (enabled.some((f) => f.kind === "order")) {
    if (!customer) throw bad(`Ticket #${ticket.id} isn't from a ShopKart customer, so there are no orders to pick from`);
    orders = await customerOrders(customer.id);
    if (b.order_ids?.length) {
      const wanted = new Set(b.order_ids.map(Number));
      orders = orders.filter((o) => wanted.has(o.id));
    }
    if (!orders.length) throw bad(b.order_ids?.length ? `None of orders ${b.order_ids.join(", ")} belong to ${ticket.requester.name}` : `${ticket.requester.name} has no orders`);
  }

  const fields: InfoRequestField[] = enabled.map(({ enabled: _, options, ...f }) => ({
    ...f,
    ...(f.kind === "order" && { choices: orders.slice(0, ORDER_CHOICES).map(orderChoice) }),
    ...(f.kind === "choice" && { choices: (options ?? []).map((o) => ({ value: o, label: o })) }),
  }));

  // One form at a time per chat: a new one replaces any still waiting.
  await db
    .update(s.infoRequests)
    .set({ status: "withdrawn" })
    .where(and(eq(s.infoRequests.ticket_id, ticket.id), eq(s.infoRequests.status, "waiting")));
  const [row] = await db
    .insert(s.infoRequests)
    .values({ ticket_id: ticket.id, customer_id: customer?.id ?? null, form_id: form.id, title: form.title, ask: form.ask, fields, requested_by: by, created_at: new Date() })
    .returning({ id: s.infoRequests.id });

  const who = by === BOT ? "Aria" : by;
  await Promise.all([
    addComment(ticket.id, { public: false, author: by, body: `${who} sent the "${form.title}" form to the customer's chat, asking for: ${fields.map((f) => f.label).join(" · ")}` }),
    updateTicket(ticket.id, { status: "pending", actor: by === BOT ? "ai" : "human" }),
  ]);
  return findRequest(row!.id);
}

function answerOf(f: InfoRequestField, raw: unknown): InfoAnswer | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    if (f.required) throw bad(`"${f.label}" needs an answer`);
    return null;
  }
  switch (f.kind) {
    case "order":
    case "choice": {
      const c = f.choices?.find((x) => x.value === value);
      if (!c) throw bad(`"${value}" isn't one of the choices for "${f.label}"`);
      return { key: f.key, label: f.label, value, text: f.kind === "order" ? `#${value} ${c.label}` : c.label };
    }
    case "text":
      if (value.length > MAX_TEXT) throw bad(`"${f.label}" can be at most ${MAX_TEXT} characters`);
      return { key: f.key, label: f.label, value, text: value };
    case "photo":
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) throw bad(`"${f.label}" must be a JPEG, PNG or WebP image`);
      if (value.length > MAX_PHOTO_CHARS) throw bad(`"${f.label}" is too large; send a smaller photo`);
      return { key: f.key, label: f.label, value, text: "attached" };
  }
}

/** The answers as one line, as the customer would have typed them. */
function summaryOf(request: InfoRequest, answers: InfoAnswer[]): string {
  return answers
    .map((a) => {
      const f = request.fields.find((x) => x.key === a.key)!;
      if (f.kind === "order") return `Order #${a.value} (${f.choices?.find((c) => c.value === a.value)?.label})`;
      return `${a.label.replace(/\?$/, "")}: ${a.text}`;
    })
    .join(" · ");
}

async function answerRequest(id: number, b: AnswerInfoRequestBody): Promise<AnswerInfoRequestResponse> {
  const request = await findRequest(id);
  if (request.status !== "waiting") throw new HttpError(409, request.status === "answered" ? "These details were already sent" : "This form was withdrawn");
  if (!b?.answers || typeof b.answers !== "object") throw bad("Send { answers: { [field key]: value } }");
  const answers = request.fields.map((f) => answerOf(f, b.answers[f.key])).filter((a): a is InfoAnswer => a !== null);
  if (!answers.length) throw bad("Answer at least one question");

  // Only the first answer counts, even if the customer taps Send twice.
  const [saved] = await db
    .update(s.infoRequests)
    .set({ status: "answered", answers, answered_at: new Date() })
    .where(and(eq(s.infoRequests.id, id), eq(s.infoRequests.status, "waiting")))
    .returning({ id: s.infoRequests.id });
  if (!saved) throw new HttpError(409, "These details were already sent");

  const summary = summaryOf(request, answers);
  const ticket = await findTicket(request.ticket_id);
  const to_aria = request.requested_by === BOT && ticket.assignee === BOT;
  if (!to_aria) {
    // A person asked: the answers go straight on the ticket for them, and it's theirs to pick up again.
    await addComment(ticket.id, { public: true, author: ticket.requester.name, author_type: "customer", body: summary });
    await updateTicket(ticket.id, { status: "open" });
  }
  return { request: await findRequest(id), summary, to_aria };
}

async function withdrawRequest(id: number): Promise<InfoRequest> {
  const [row] = await db
    .update(s.infoRequests)
    .set({ status: "withdrawn" })
    .where(and(eq(s.infoRequests.id, id), eq(s.infoRequests.status, "waiting")))
    .returning({ id: s.infoRequests.id });
  if (!row) throw new HttpError(409, "Only a form that is still waiting can be withdrawn");
  return findRequest(id);
}

/* ───── Routes ───── */

export const formRoutes = {
  "/info/forms": {
    GET: handle(async () => ok({ forms: await listForms() })),
  },
  "/info/forms/:id": {
    PATCH: handle(async (req) => ok(await updateForm(req.params.id ?? "", await body<UpdateInfoFormBody>(req)))),
  },
  "/info/requests": {
    GET: handle(async (req) => {
      const q = new URL(req.url).searchParams;
      const where: Parameters<typeof and> = [];
      if (q.get("ticket_id")) where.push(eq(s.infoRequests.ticket_id, intParam(q.get("ticket_id")!, "ticket_id")));
      if (q.get("status")) where.push(eq(s.infoRequests.status, oneOf<InfoRequestStatus>(q.get("status"), STATUSES, "status")));
      return ok({ requests: await requestRows(where) });
    }),
    POST: handle(async (req) => ok(await createInfoRequest(await body<CreateInfoRequestBody>(req)), 201)),
  },
  "/info/requests/:id/answer": {
    POST: handle(async (req) => ok(await answerRequest(intParam(req.params.id, "Request id"), await body<AnswerInfoRequestBody>(req)))),
  },
  "/info/requests/:id/withdraw": {
    POST: handle(async (req) => ok(await withdrawRequest(intParam(req.params.id, "Request id")))),
  },
};
