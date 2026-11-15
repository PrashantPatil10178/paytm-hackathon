import {
  BOT,
  DEAL_STAGES,
  type Activity,
  type BookMeetingBody,
  type Contact,
  type CreateContactBody,
  type CreateDealBody,
  type CreateNoteBody,
  type Deal,
  type DealCard,
  type DealDetail,
  type DealStage,
  type Meeting,
  type SaveQuoteBody,
  type Slot,
  type UpdateDealBody,
} from "@ph/shared";
import { desc, eq, schema as s, toActivity, toContact, toDeal, toMeeting, type Tx } from "@ph/db";
import { db } from "./db.ts";
import { bad, body, handle, intParam, notFound, ok, oneOf } from "./http.ts";

const STAGE_IDS = DEAL_STAGES.map((x) => x.id);
const SCORES = ["hot", "warm", "cold"] as const;
const stageLabel = (x: DealStage) => DEAL_STAGES.find((y) => y.id === x)!.label;

export async function findDeal(id: number, tx: Tx = db): Promise<Deal> {
  const row = await tx.query.deals.findFirst({ where: eq(s.deals.id, id), with: { meeting: true } });
  if (!row) throw notFound(`Deal ${id}`);
  return toDeal(row);
}

async function findContact(id: number, tx: Tx = db): Promise<Contact> {
  const [row] = await tx.select().from(s.contacts).where(eq(s.contacts.id, id));
  if (!row) throw notFound(`Contact ${id}`);
  return toContact(row);
}

export async function logActivity(dealId: number, a: Omit<Activity, "id" | "created_at">, tx: Tx = db): Promise<Activity> {
  const at = new Date();
  const [row] = await tx.insert(s.activities).values({ ...a, deal_id: dealId, created_at: at }).returning();
  await tx.update(s.deals).set({ updated_at: at }).where(eq(s.deals.id, dealId));
  return toActivity(row!);
}

async function cards(where?: ReturnType<typeof eq>): Promise<DealCard[]> {
  const rows = await db.query.deals.findMany({ where, with: { meeting: true, contact: { columns: { id: true, name: true, company: true } } }, orderBy: s.deals.id });
  return rows.map((r) => ({ ...toDeal(r), contact: r.contact }));
}

async function detail(id: number): Promise<DealDetail> {
  const row = await db.query.deals.findFirst({
    where: eq(s.deals.id, id),
    with: { meeting: true, contact: true, activities: { orderBy: [desc(s.activities.created_at), desc(s.activities.id)] } },
  });
  if (!row) throw notFound(`Deal ${id}`);
  return { ...toDeal(row), contact: toContact(row.contact), activities: row.activities.map(toActivity) };
}

/* ───── Operations (also used by the built-in lead simulator) ───── */

export async function createContact(b: CreateContactBody): Promise<Contact> {
  if (!b.name?.trim() || !b.email?.trim()) throw bad("name and email are required");
  const [row] = await db
    .insert(s.contacts)
    .values({
      name: b.name.trim(),
      email: b.email.trim(),
      phone: b.phone ?? "",
      company: b.company ?? "",
      lead_status: b.lead_status ?? "New",
      owner: b.owner ?? BOT,
      source: b.source ?? "Chat",
      created_at: new Date(),
    })
    .returning();
  return toContact(row!);
}

export async function createDeal(b: CreateDealBody): Promise<Deal> {
  if (!b.name?.trim()) throw bad("name is required");
  if (typeof b.amount !== "number" || b.amount < 0) throw bad("amount must be a positive number (₹)");
  return db.transaction(async (tx) => {
    const contact = await findContact(b.contact_id, tx);
    const at = new Date();
    const close = new Date();
    close.setDate(close.getDate() + 30);
    const [row] = await tx
      .insert(s.deals)
      .values({
        name: b.name.trim(),
        amount: b.amount,
        stage: b.stage ? oneOf(b.stage, STAGE_IDS, "stage") : "new_lead",
        contact_id: contact.id,
        owner: b.owner ?? BOT,
        score: b.score ? oneOf(b.score, SCORES, "score") : "warm",
        next_step: b.next_step ?? "",
        close_date: b.close_date ? new Date(b.close_date) : close,
        created_at: at,
        updated_at: at,
      })
      .returning({ id: s.deals.id });
    if (contact.lead_status === "New") await tx.update(s.contacts).set({ lead_status: "Open deal" }).where(eq(s.contacts.id, contact.id));
    return findDeal(row!.id, tx);
  });
}

export async function updateDeal(id: number, b: UpdateDealBody): Promise<Deal> {
  return db.transaction(async (tx) => {
    const d = await findDeal(id, tx);
    const byAi = b.actor !== "human";
    const author = byAi ? BOT : (b.author ?? "Sales team");
    const next: Partial<typeof s.deals.$inferInsert> = { updated_at: new Date() };
    if (b.stage !== undefined) {
      const stage = oneOf(b.stage, STAGE_IDS, "stage");
      if (stage !== d.stage) {
        await logActivity(d.id, { type: "stage_change", body: `Stage moved from ${stageLabel(d.stage)} to ${stageLabel(stage)}`, author, ai: byAi }, tx);
        next.stage = stage;
      }
    }
    if (b.score !== undefined) next.score = oneOf(b.score, SCORES, "score");
    if (b.name !== undefined) next.name = b.name;
    if (b.amount !== undefined) next.amount = b.amount;
    if (b.owner !== undefined) next.owner = b.owner;
    if (b.next_step !== undefined) next.next_step = b.next_step;
    if (b.close_date !== undefined) next.close_date = new Date(b.close_date);
    if (b.payment_link !== undefined) next.payment_link = b.payment_link;
    await tx.update(s.deals).set(next).where(eq(s.deals.id, id));
    return findDeal(id, tx);
  });
}

export async function freeSlots(): Promise<Slot[]> {
  const booked = new Set((await db.select({ start: s.meetings.start }).from(s.meetings)).map((m) => m.start.getTime()));
  const slots: Slot[] = [];
  const day = new Date();
  day.setMinutes(0, 0, 0);
  for (let added = 0; added < 3; ) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    added++;
    for (const hour of [10, 11, 12, 14, 15, 16, 17]) {
      const t = new Date(day);
      t.setHours(hour, 0, 0, 0);
      if (booked.has(t.getTime())) continue;
      slots.push({ start: t.toISOString(), end: new Date(t.getTime() + 30 * 60_000).toISOString() });
    }
  }
  return slots;
}

async function bookMeeting(b: BookMeetingBody): Promise<Meeting> {
  if (!b.start || Number.isNaN(Date.parse(b.start))) throw bad("start must be an ISO date-time from GET /crm/slots");
  return db.transaction(async (tx) => {
    const d = await findDeal(b.deal_id, tx);
    const contact = await findContact(d.contact_id, tx);
    const values = {
      deal_id: d.id,
      title: b.title ?? `${d.name.split("–")[1]?.trim() ?? "Intro"} call – ${contact.company}`,
      start: new Date(b.start),
      duration_min: b.duration_min ?? 30,
      attendees: [contact.name, d.owner === BOT ? "Rahul – Sales" : d.owner],
    };
    // One meeting per deal: booking again moves it.
    const [row] = await tx.insert(s.meetings).values(values).onConflictDoUpdate({ target: s.meetings.deal_id, set: values }).returning();
    const when = row!.start.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    await logActivity(d.id, { type: "meeting", body: `Booked "${row!.title}" for ${when}.`, author: BOT, ai: true }, tx);
    return toMeeting(row!);
  });
}

/* ───── Routes ───── */

export const crmRoutes = {
  "/crm/contacts": {
    GET: handle(async () => {
      const rows = await db.query.contacts.findMany({ with: { deals: { columns: { id: true } } }, orderBy: [desc(s.contacts.created_at), desc(s.contacts.id)] });
      const contacts = rows.map(({ deals, ...c }) => ({ ...toContact(c), deal_ids: deals.map((x) => x.id).sort((a, b) => a - b) }));
      return ok({ contacts });
    }),
    POST: handle(async (req) => ok(await createContact(await body<CreateContactBody>(req)), 201)),
  },
  "/crm/contacts/:id": {
    GET: handle(async (req) => {
      const c = await findContact(intParam(req.params.id, "Contact id"));
      return ok({ ...c, deals: await cards(eq(s.deals.contact_id, c.id)) });
    }),
  },
  "/crm/deals": {
    GET: handle(async () => ok({ stages: DEAL_STAGES, deals: await cards() })),
    POST: handle(async (req) => ok(await createDeal(await body<CreateDealBody>(req)), 201)),
  },
  "/crm/deals/:id": {
    GET: handle(async (req) => ok(await detail(intParam(req.params.id, "Deal id")))),
    PATCH: handle(async (req) => ok(await updateDeal(intParam(req.params.id, "Deal id"), await body<UpdateDealBody>(req)))),
  },
  "/crm/deals/:id/notes": {
    POST: handle(async (req) => {
      const d = await findDeal(intParam(req.params.id, "Deal id"));
      const b = await body<CreateNoteBody>(req);
      if (!b.body?.trim()) throw bad("body is required");
      const author = b.author ?? BOT;
      return ok(await logActivity(d.id, { type: b.type ?? "note", body: b.body.trim(), author, ai: b.ai ?? author === BOT }), 201);
    }),
  },
  "/crm/deals/:id/quote": {
    POST: handle(async (req) => {
      const d = await findDeal(intParam(req.params.id, "Deal id"));
      const b = await body<SaveQuoteBody>(req);
      if (!Array.isArray(b.items) || !b.items.length) throw bad("items must list at least one { name, qty, unit_price }");
      const amount = b.items.reduce((sum, i) => sum + i.qty * i.unit_price, 0);
      const status = b.status ? oneOf(b.status, ["draft", "waiting_approval", "sent"] as const, "status") : "draft";
      const quote = { items: b.items, amount, status, updated_at: new Date().toISOString() };
      const verb = status === "sent" ? "Sent" : status === "waiting_approval" ? "Sent for approval:" : "Drafted";
      await db.transaction(async (tx) => {
        await tx.update(s.deals).set({ quote }).where(eq(s.deals.id, d.id));
        await logActivity(d.id, { type: "quote", body: `${verb} a quote for ₹${amount.toLocaleString("en-IN")} (${b.items.length} line items).`, author: BOT, ai: true }, tx);
      });
      return ok(quote, 201);
    }),
  },
  "/crm/slots": {
    GET: handle(async () => ok({ slots: await freeSlots() })),
  },
  "/crm/meetings": {
    POST: handle(async (req) => ok(await bookMeeting(await body<BookMeetingBody>(req)), 201)),
  },
};
