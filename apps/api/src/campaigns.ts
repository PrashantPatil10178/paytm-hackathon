/**
 * Campaigns and the people who answered them. The leads agent reads new responses and turns each one
 * into a CRM contact + deal (convert) or sets it aside (skip). The rules that must hold no matter what
 * the model does live here: a response is processed once, and an email that already has a contact
 * reuses it instead of creating a duplicate.
 */
import {
  BOT,
  CAMPAIGN_CHANNELS,
  ENQUIRY_NEEDS,
  type CampaignLanding,
  type LandingSubmission,
  type CampaignResponse,
  type CampaignResponseStatus,
  type CampaignSummary,
  type ConvertResponseBody,
  type ConvertResponseResult,
  type SkipResponseBody,
} from "@ph/shared";
import { and, count, desc, eq, schema as s, sql, toCampaign, toCampaignResponse, toContact, type Tx } from "@ph/db";
import { findDeal, logActivity } from "./crm.ts";
import { db } from "./db.ts";
import { bad, body, handle, HttpError, intParam, notFound, ok, oneOf } from "./http.ts";

const STATUSES = ["new", "converted", "skipped"] as const;
const SCORES = ["hot", "warm", "cold"] as const;
const channelLabel = (id: string) => CAMPAIGN_CHANNELS.find((c) => c.id === id)?.label ?? id;

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(s.campaigns).orderBy(s.campaigns.id),
    db
      .select({ campaign_id: s.campaignResponses.campaign_id, status: s.campaignResponses.status, n: count() })
      .from(s.campaignResponses)
      .groupBy(s.campaignResponses.campaign_id, s.campaignResponses.status),
  ]);
  return rows.map((c) => {
    const mine = counts.filter((x) => x.campaign_id === c.id);
    const of = (st: CampaignResponseStatus) => mine.find((x) => x.status === st)?.n ?? 0;
    return { ...toCampaign(c), responses: mine.reduce((sum, x) => sum + x.n, 0), new: of("new"), converted: of("converted"), skipped: of("skipped") };
  });
}

const withCampaign = { campaign: { columns: { id: true, name: true, channel: true } } } as const;

export async function listResponses(filter: { status?: CampaignResponseStatus; campaignId?: number; limit?: number } = {}): Promise<CampaignResponse[]> {
  const where = and(
    filter.status ? eq(s.campaignResponses.status, filter.status) : undefined,
    filter.campaignId ? eq(s.campaignResponses.campaign_id, filter.campaignId) : undefined,
  );
  const rows = await db.query.campaignResponses.findMany({
    where,
    with: withCampaign,
    // New responses oldest first (a queue); processed ones newest first.
    orderBy: filter.status === "new" ? [s.campaignResponses.created_at, s.campaignResponses.id] : [desc(s.campaignResponses.created_at), desc(s.campaignResponses.id)],
    limit: filter.limit,
  });
  return rows.map(toCampaignResponse);
}

export async function findResponse(id: number, tx: Tx = db): Promise<CampaignResponse> {
  const row = await tx.query.campaignResponses.findFirst({ where: eq(s.campaignResponses.id, id), with: withCampaign });
  if (!row) throw notFound(`Campaign response ${id}`);
  return toCampaignResponse(row);
}

/** Locks the response row and checks it hasn't been processed yet. */
async function claim(id: number, tx: Tx): Promise<CampaignResponse> {
  const [locked] = await tx.select({ id: s.campaignResponses.id }).from(s.campaignResponses).where(eq(s.campaignResponses.id, id)).for("update");
  if (!locked) throw notFound(`Campaign response ${id}`);
  const r = await findResponse(id, tx);
  if (r.status !== "new") throw new HttpError(409, `Campaign response ${id} was already ${r.status}`);
  return r;
}

export async function convertResponse(id: number, b: ConvertResponseBody): Promise<ConvertResponseResult> {
  const score = oneOf(b.score, SCORES, "score");
  if (!b.deal_name?.trim()) throw bad("deal_name is required");
  if (typeof b.amount !== "number" || !Number.isFinite(b.amount) || b.amount < 0) throw bad("amount must be a positive number (₹)");
  if (!b.note?.trim()) throw bad("note is required: say why this is a lead and why this score");

  return db.transaction(async (tx) => {
    const r = await claim(id, tx);
    const at = new Date();

    // One contact per email: a campaign reply from someone already in the CRM reuses their contact.
    const [existing] = await tx.select().from(s.contacts).where(sql`lower(trim(${s.contacts.email})) = lower(trim(${r.email}))`).limit(1);
    const contactRow =
      existing ??
      (await tx
        .insert(s.contacts)
        .values({ name: r.name, email: r.email.trim(), phone: r.phone, company: r.company, lead_status: "Open deal", owner: BOT, source: "Campaign", created_at: at })
        .returning())[0]!;
    if (existing?.lead_status === "New") await tx.update(s.contacts).set({ lead_status: "Open deal" }).where(eq(s.contacts.id, existing.id));

    const close = new Date(at);
    close.setDate(close.getDate() + 30);
    const [deal] = await tx
      .insert(s.deals)
      .values({
        name: b.deal_name.trim(),
        amount: b.amount,
        stage: "new_lead",
        contact_id: contactRow.id,
        owner: BOT,
        score,
        next_step: (b.next_step ?? "").trim().slice(0, 80),
        close_date: close,
        created_at: at,
        updated_at: at,
      })
      .returning({ id: s.deals.id });

    const source = `From the "${r.campaign.name}" campaign (${channelLabel(r.campaign.channel)})`;
    await logActivity(deal!.id, { type: "note", body: `${source}. They wrote: "${r.message}". ${b.note.trim()}`, author: BOT, ai: true }, tx);
    await tx
      .update(s.campaignResponses)
      .set({ status: "converted", contact_id: contactRow.id, deal_id: deal!.id, note: b.note.trim(), processed_at: at })
      .where(eq(s.campaignResponses.id, id));

    const [contact] = await tx.select().from(s.contacts).where(eq(s.contacts.id, contactRow.id));
    return { response: await findResponse(id, tx), contact: toContact(contact!), deal: await findDeal(deal!.id, tx), existing_contact: Boolean(existing) };
  });
}

export async function skipResponse(id: number, b: SkipResponseBody): Promise<CampaignResponse> {
  if (!b.reason?.trim()) throw bad("reason is required");
  return db.transaction(async (tx) => {
    await claim(id, tx);
    await tx
      .update(s.campaignResponses)
      .set({ status: "skipped", note: b.reason.trim().slice(0, 300), processed_at: new Date() })
      .where(eq(s.campaignResponses.id, id));
    return findResponse(id, tx);
  });
}

/** The CRM contact (and their deals) that a response's email already belongs to, if any. */
export async function contactForEmail(email: string) {
  const row = await db.query.contacts.findFirst({
    where: sql`lower(trim(${s.contacts.email})) = lower(trim(${email}))`,
    with: { deals: { columns: { id: true, name: true, stage: true, amount: true } } },
  });
  return row ? { ...toContact(row), deals: row.deals } : null;
}

/* ───── Landing pages (public: ShopKart /c/<slug>) ───── */

async function campaignBySlug(slug: string) {
  const [row] = await db.select().from(s.campaigns).where(eq(s.campaigns.slug, slug.toLowerCase()));
  if (!row) throw notFound(`Campaign "${slug}"`);
  return row;
}

const landingView = (c: typeof s.campaigns.$inferSelect): CampaignLanding => ({ id: c.id, name: c.name, slug: c.slug, headline: c.headline || c.name, pitch: c.pitch, status: c.status, channel: c.channel });

/**
 * Spam-safe basics, in memory (the demo API is one process): at most 5 submissions per IP per 10 minutes and
 * 3 per email per hour. Over that: 429. Duplicates under the limit are allowed: the leads agent decides.
 */
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3_600_000)) hits.delete(k);
  return false;
}

/** The submitter's IP: the app proxy forwards it (x-forwarded-for); a direct call has none. */
const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A landing form submission → a campaign response (status new) for the leads agent. */
async function submitLanding(slug: string, b: LandingSubmission, ip: string): Promise<{ ok: true; id: number | null }> {
  const c = await campaignBySlug(slug);
  if (c.status !== "active") throw new HttpError(409, "This campaign isn't taking replies right now.");
  // Honeypot: a hidden field people never see. Bots fill it; say thanks and store nothing.
  if (typeof b.website === "string" && b.website.trim()) return { ok: true, id: null };
  const text = (v: unknown, field: string, max: number, required = true) => {
    const t = typeof v === "string" ? v.trim() : "";
    if (required && !t) throw bad(`${field} is required`);
    if (t.length > max) throw bad(`${field} is too long (${max} characters at most)`);
    return t;
  };
  const name = text(b.name, "Name", 80);
  const email = text(b.email, "Email", 120).toLowerCase();
  if (!EMAIL.test(email)) throw bad("Enter a valid email address");
  const phone = text(b.phone, "Phone", 20);
  if (phone.replace(/\D/g, "").length < 10) throw bad("Enter a phone number with at least 10 digits");
  const company = text(b.company, "Company", 100);
  const need = oneOf(b.need, ENQUIRY_NEEDS.map((n) => n.id), "need");
  const budget = b.budget === undefined || b.budget === null || (b.budget as unknown) === "" ? null : Number(b.budget);
  if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 1e9)) throw bad("Budget must be an amount in ₹");
  const start_when = text(b.start_when, "Start", 40, false);
  const message = text(b.message, "Message", 1000, false);
  if (limited(`ip:${ip}`, 5, 10 * 60_000) || limited(`email:${email}`, 3, 60 * 60_000)) throw new HttpError(429, "Too many replies in a short time. Please try again later.");
  const [row] = await db
    .insert(s.campaignResponses)
    .values({ campaign_id: c.id, name, email, phone, company, need, budget, start_when, message, status: "new", created_at: new Date() })
    .returning({ id: s.campaignResponses.id });
  return { ok: true, id: row!.id };
}

/* ───── Routes ───── */

export const campaignRoutes = {
  /** The landing page's content. `?visit=1` (once per page load) counts a visit. */
  "/campaigns/landing/:slug": {
    GET: handle(async (req) => {
      const c = await campaignBySlug(String(req.params.slug));
      if (new URL(req.url).searchParams.get("visit") === "1") {
        await db.update(s.campaigns).set({ landing_visits: sql`${s.campaigns.landing_visits} + 1` }).where(eq(s.campaigns.id, c.id));
      }
      return ok({ campaign: landingView(c) });
    }),
  },
  "/campaigns/landing/:slug/responses": {
    POST: handle(async (req) => ok(await submitLanding(String(req.params.slug), await body<LandingSubmission>(req), clientIp(req)), 201)),
  },
  "/campaigns": {
    GET: handle(async () => ok({ campaigns: await listCampaigns() })),
  },
  "/campaigns/responses": {
    GET: handle(async (req) => {
      const q = new URL(req.url).searchParams;
      const status = q.get("status") ? oneOf(q.get("status"), STATUSES, "status") : undefined;
      const campaignId = q.get("campaign_id") ? intParam(q.get("campaign_id")!, "campaign_id") : undefined;
      const limit = q.get("limit") ? Math.min(100, Math.max(1, intParam(q.get("limit")!, "limit"))) : undefined;
      return ok({ responses: await listResponses({ status, campaignId, limit }) });
    }),
  },
  "/campaigns/responses/:id": {
    GET: handle(async (req) => {
      const r = await findResponse(intParam(req.params.id, "Response id"));
      return ok({ ...r, existing_contact: await contactForEmail(r.email) });
    }),
  },
  "/campaigns/responses/:id/convert": {
    POST: handle(async (req) => ok(await convertResponse(intParam(req.params.id, "Response id"), await body<ConvertResponseBody>(req)), 201)),
  },
  "/campaigns/responses/:id/skip": {
    POST: handle(async (req) => ok(await skipResponse(intParam(req.params.id, "Response id"), await body<SkipResponseBody>(req)))),
  },
};
