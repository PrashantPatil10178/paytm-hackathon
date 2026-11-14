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
  type SaveQuoteBody,
  type Slot,
  type UpdateDealBody,
} from "@ph/shared";
import { db } from "./db.ts";
import { bad, body, handle, intParam, notFound, now, ok, oneOf } from "./http.ts";

const STAGE_IDS = DEAL_STAGES.map((s) => s.id);
const SCORES = ["hot", "warm", "cold"] as const;
const stageLabel = (s: DealStage) => DEAL_STAGES.find((x) => x.id === s)!.label;

export function findDeal(id: number): Deal {
  const d = db.deals.find((x) => x.id === id);
  if (!d) throw notFound(`Deal ${id}`);
  return d;
}

function findContact(id: number): Contact {
  const c = db.contacts.find((x) => x.id === id);
  if (!c) throw notFound(`Contact ${id}`);
  return c;
}

export function logActivity(dealId: number, a: Omit<Activity, "id" | "created_at">): Activity {
  const entry: Activity = { id: ++db.seq.activity, created_at: now(), ...a };
  const list = db.activities.get(dealId) ?? [];
  list.push(entry);
  db.activities.set(dealId, list);
  const d = db.deals.find((x) => x.id === dealId);
  if (d) d.updated_at = entry.created_at;
  return entry;
}

const card = (d: Deal): DealCard => {
  const c = findContact(d.contact_id);
  return { ...d, contact: { id: c.id, name: c.name, company: c.company } };
};

const detail = (d: Deal): DealDetail => ({
  ...d,
  contact: findContact(d.contact_id),
  activities: [...(db.activities.get(d.id) ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
});

/* ───── Operations (also used by the built-in lead simulator) ───── */

export function createContact(b: CreateContactBody): Contact {
  if (!b.name?.trim() || !b.email?.trim()) throw bad("name and email are required");
  const contact: Contact = {
    id: ++db.seq.contact,
    name: b.name.trim(),
    email: b.email.trim(),
    phone: b.phone ?? "",
    company: b.company ?? "",
    lead_status: b.lead_status ?? "New",
    owner: b.owner ?? BOT,
    source: b.source ?? "Chat",
    created_at: now(),
  };
  db.contacts.push(contact);
  return contact;
}

export function createDeal(b: CreateDealBody): Deal {
  if (!b.name?.trim()) throw bad("name is required");
  if (typeof b.amount !== "number" || b.amount < 0) throw bad("amount must be a positive number (₹)");
  const contact = findContact(b.contact_id);
  const at = now();
  const close = new Date();
  close.setDate(close.getDate() + 30);
  const deal: Deal = {
    id: ++db.seq.deal,
    name: b.name.trim(),
    amount: b.amount,
    stage: b.stage ? oneOf(b.stage, STAGE_IDS, "stage") : "new_lead",
    contact_id: contact.id,
    owner: b.owner ?? BOT,
    score: b.score ? oneOf(b.score, SCORES, "score") : "warm",
    next_step: b.next_step ?? "",
    close_date: b.close_date ?? close.toISOString(),
    meeting: null,
    quote: null,
    payment_link: null,
    tasks: [],
    created_at: at,
    updated_at: at,
  };
  db.deals.push(deal);
  if (contact.lead_status === "New") contact.lead_status = "Open deal";
  return deal;
}

export function updateDeal(id: number, b: UpdateDealBody): Deal {
  const d = findDeal(id);
  const byAi = b.actor !== "human";
  const author = byAi ? BOT : (b.author ?? "Sales team");
  if (b.stage !== undefined) {
    const next = oneOf(b.stage, STAGE_IDS, "stage");
    if (next !== d.stage) {
      logActivity(d.id, { type: "stage_change", body: `Stage moved from ${stageLabel(d.stage)} to ${stageLabel(next)}`, author, ai: byAi });
      d.stage = next;
    }
  }
  if (b.score !== undefined) d.score = oneOf(b.score, SCORES, "score");
  if (b.name !== undefined) d.name = b.name;
  if (b.amount !== undefined) d.amount = b.amount;
  if (b.owner !== undefined) d.owner = b.owner;
  if (b.next_step !== undefined) d.next_step = b.next_step;
  if (b.close_date !== undefined) d.close_date = b.close_date;
  if (b.payment_link !== undefined) d.payment_link = b.payment_link;
  d.updated_at = now();
  return d;
}

export function freeSlots(): Slot[] {
  const booked = new Set(db.deals.flatMap((d) => (d.meeting ? [new Date(d.meeting.start).getTime()] : [])));
  const slots: Slot[] = [];
  const day = new Date();
  day.setMinutes(0, 0, 0);
  for (let added = 0; added < 3; ) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    added++;
    for (const hour of [10, 11, 12, 14, 15, 16, 17]) {
      const s = new Date(day);
      s.setHours(hour, 0, 0, 0);
      if (booked.has(s.getTime())) continue;
      slots.push({ start: s.toISOString(), end: new Date(s.getTime() + 30 * 60_000).toISOString() });
    }
  }
  return slots;
}

/* ───── Routes ───── */

export const crmRoutes = {
  "/crm/contacts": {
    GET: handle(() => {
      const contacts = [...db.contacts]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((c) => ({ ...c, deal_ids: db.deals.filter((d) => d.contact_id === c.id).map((d) => d.id) }));
      return ok({ contacts });
    }),
    POST: handle(async (req) => ok(createContact(await body<CreateContactBody>(req)), 201)),
  },
  "/crm/contacts/:id": {
    GET: handle((req) => {
      const c = findContact(intParam(req.params.id, "Contact id"));
      return ok({ ...c, deals: db.deals.filter((d) => d.contact_id === c.id).map(card) });
    }),
  },
  "/crm/deals": {
    GET: handle(() => ok({ stages: DEAL_STAGES, deals: db.deals.map(card) })),
    POST: handle(async (req) => ok(createDeal(await body<CreateDealBody>(req)), 201)),
  },
  "/crm/deals/:id": {
    GET: handle((req) => ok(detail(findDeal(intParam(req.params.id, "Deal id"))))),
    PATCH: handle(async (req) => ok(updateDeal(intParam(req.params.id, "Deal id"), await body<UpdateDealBody>(req)))),
  },
  "/crm/deals/:id/notes": {
    POST: handle(async (req) => {
      const d = findDeal(intParam(req.params.id, "Deal id"));
      const b = await body<CreateNoteBody>(req);
      if (!b.body?.trim()) throw bad("body is required");
      const author = b.author ?? BOT;
      const entry = logActivity(d.id, { type: b.type ?? "note", body: b.body.trim(), author, ai: b.ai ?? author === BOT });
      return ok(entry, 201);
    }),
  },
  "/crm/deals/:id/quote": {
    POST: handle(async (req) => {
      const d = findDeal(intParam(req.params.id, "Deal id"));
      const b = await body<SaveQuoteBody>(req);
      if (!Array.isArray(b.items) || !b.items.length) throw bad("items must list at least one { name, qty, unit_price }");
      const amount = b.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      const status = b.status ? oneOf(b.status, ["draft", "waiting_approval", "sent"] as const, "status") : "draft";
      d.quote = { items: b.items, amount, status, updated_at: now() };
      const verb = status === "sent" ? "Sent" : status === "waiting_approval" ? "Sent for approval:" : "Drafted";
      logActivity(d.id, { type: "quote", body: `${verb} a quote for ₹${amount.toLocaleString("en-IN")} (${b.items.length} line items).`, author: BOT, ai: true });
      return ok(d.quote, 201);
    }),
  },
  "/crm/slots": {
    GET: handle(() => ok({ slots: freeSlots() })),
  },
  "/crm/meetings": {
    POST: handle(async (req) => {
      const b = await body<BookMeetingBody>(req);
      const d = findDeal(b.deal_id);
      if (!b.start || Number.isNaN(Date.parse(b.start))) throw bad("start must be an ISO date-time from GET /crm/slots");
      const contact = findContact(d.contact_id);
      d.meeting = {
        id: ++db.seq.meeting,
        deal_id: d.id,
        title: b.title ?? `${d.name.split("–")[1]?.trim() ?? "Intro"} call – ${contact.company}`,
        start: new Date(b.start).toISOString(),
        duration_min: b.duration_min ?? 30,
        attendees: [contact.name, d.owner === BOT ? "Rahul – Sales" : d.owner],
      };
      const when = new Date(d.meeting.start).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      logActivity(d.id, { type: "meeting", body: `Booked "${d.meeting.title}" for ${when}.`, author: BOT, ai: true });
      return ok(d.meeting, 201);
    }),
  },
};
