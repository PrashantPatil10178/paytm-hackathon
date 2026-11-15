/**
 * The demo data: only the shop's catalogue (customers 101–105, products, orders, their Zendesk users) and
 * the 4 campaigns. Tickets, CRM contacts and deals, campaign responses and reports are never seeded: they
 * appear when real requests come in (ShopKart chat, the enquiry form, voice calls, the agents), so every
 * screen shows only what really happened. Seeded relative to "now" so order dates look recent.
 * `resetDemoData` wipes the demo tables and writes it again (POST /admin/reset, `bun run reset`);
 * `ensureSeeded` does it only when the database is empty (API startup).
 */
import type { Settings } from "@ph/shared/controlroom";
import type { Campaign, Customer, InfoForm, Order, Product, ZdUser } from "@ph/shared";
import { count, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "./client.ts";
import * as s from "./schema.ts";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function build() {
  /* ───── ShopKart ───── */
  const customers: Customer[] = [
    { id: 101, name: "Rohan Mehta", email: "rohan.mehta@mail.example", phone: "+91 86685 92601", city: "Pune" },
    { id: 102, name: "Ananya Iyer", email: "ananya.iyer@mail.example", phone: "+91 86685 92601", city: "Bengaluru" },
    { id: 103, name: "Vikram Singh", email: "vikram.singh@mail.example", phone: "+91 86685 92601", city: "New Delhi" },
    { id: 104, name: "Sneha Kulkarni", email: "sneha.k@mail.example", phone: "+91 86685 92601", city: "Mumbai" },
    { id: 105, name: "Arjun Nair", email: "arjun.nair@mail.example", phone: "+91 86685 92601", city: "Kochi" },
  ];

  const img = (f: string) => `/static/${f}.jpg`;
  const products: Product[] = [
    { id: 1, name: "Wireless Over-Ear Headphones", category: "Audio", price: 2499, mrp: 3999, image: img("headphones"), rating: 4.4, reviews: 2318 },
    { id: 2, name: "Minimal Smartwatch, White", category: "Wearables", price: 7500, mrp: 9999, image: img("watch"), rating: 4.2, reviews: 864 },
    { id: 3, name: "Instant Film Camera", category: "Cameras", price: 8999, mrp: 9999, image: img("camera"), rating: 4.6, reviews: 512 },
    { id: 4, name: "Classic Black Sunglasses", category: "Accessories", price: 1299, mrp: 1999, image: img("sunglasses"), rating: 4.1, reviews: 1407 },
    { id: 5, name: "Everyday Laptop Backpack", category: "Bags", price: 1799, mrp: 2499, image: img("backpack"), rating: 4.5, reviews: 3120 },
    { id: 6, name: "Insulated Steel Bottle, 750 ml", category: "Home", price: 499, mrp: 799, image: img("bottle"), rating: 4.3, reviews: 5872 },
    { id: 7, name: "Cotton Crew T-shirt, White", category: "Fashion", price: 599, mrp: 899, image: img("tshirt"), rating: 4.0, reviews: 2210 },
    { id: 8, name: "Stoneware Coffee Mugs, Set of 2", category: "Home", price: 500, mrp: 699, image: img("mug"), rating: 4.2, reviews: 941 },
  ];
  const p = (id: number) => products.find((x) => x.id === id)!;
  const line = (id: number, qty = 1) => ({ product_id: id, name: p(id).name, image: p(id).image, qty, price: p(id).price });
  const order = (
    id: number,
    customer_id: number,
    items: ReturnType<typeof line>[],
    status: Order["status"],
    payment_status: Order["payment_status"],
    placed_days: number,
  ): Order => ({
    id,
    customer_id,
    items,
    amount: items.reduce((s, i) => s + i.qty * i.price, 0),
    status,
    payment_status,
    placed_at: daysAgo(placed_days),
    updated_at: daysAgo(Math.max(0, placed_days - 2)),
  });

  const orders: Order[] = [
    order(1018, 101, [line(1)], "delivered", "paid", 21),
    // Refund demo: delivered yesterday, then reported damaged. ₹500. Inside POL-DMG's 48-hour report window.
    order(1023, 102, [line(8)], "damaged", "paid", 3),
    // Photo-proof demo: Sneha's T-shirts (₹1,198, above the ₹1,000 photo rule) were delivered yesterday.
    order(1027, 104, [line(7, 2)], "delivered", "paid", 3),
    order(1031, 105, [line(5)], "shipped", "paid", 3),
    order(1034, 101, [line(4)], "shipped", "cod", 2),
    order(1038, 102, [line(6), line(7)], "placed", "paid", 1),
    order(1041, 103, [line(5)], "delivered", "paid", 15),
    order(1044, 104, [line(3)], "placed", "paid", 1),
    order(1047, 105, [line(1)], "delivered", "refunded", 18),
    // Escalation demo: ₹15,000 debited from the bank, payment never confirmed.
    order(1050, 103, [line(2, 2)], "placed", "failed_debited", 0),
    order(1053, 101, [line(6, 2)], "placed", "cod", 0),
    order(1056, 104, [line(2)], "shipped", "paid", 4),
  ];

  /* ───── Zendesk: the shop's customers are its requesters. Tickets come only from real requests. ───── */
  const zdUsers: ZdUser[] = customers.map(({ id, name, email, phone }) => ({ id, name, email, phone }));

  return {
    zdUsers,
    products,
    customers,
    orders,
    // Where each id sequence continues from, so new records get the numbers the demo script expects (#2041, …).
    // Contacts, deals and the rest start at 1 (truncate … restart identity).
    next: { tickets: 2040, ticket_comments: 9000, zd_users: 300 },
  };
}

const date = (iso: string) => new Date(iso);

/* ───── Campaigns: the leads agent's input. Seeded on their own too, so a database seeded before they existed gets them. ───── */

function buildCampaigns(): Campaign[] {
  return [
    {
      id: 1, name: "Diwali bulk gifting", channel: "meta_ads", status: "active", budget: 60000, spend: 38400, impressions: 182000, clicks: 3640, started_at: daysAgo(12),
      slug: "diwali-bulk-gifting", headline: "Diwali gifts for your whole team, sorted",
      pitch: "Branded hampers, sweets boxes and gift sets from ShopKart, packed with your logo and delivered to every office or home address in India. Bulk pricing from 50 boxes.",
      landing_visits: 0,
    },
    {
      id: 2, name: "GST billing for restaurants", channel: "google_ads", status: "active", budget: 40000, spend: 27150, impressions: 64000, clicks: 2180, started_at: daysAgo(9),
      slug: "gst-billing-for-restaurants", headline: "GST billing that keeps up with a busy kitchen",
      pitch: "ShopKart's billing setup gives restaurants GST invoices, table and takeaway orders and daily reports in one place, set up by our team in a day.",
      landing_visits: 0,
    },
    {
      id: 3, name: "UPI payments for D2C stores", channel: "whatsapp", status: "active", budget: 15000, spend: 9800, impressions: 21000, clicks: 1460, started_at: daysAgo(6),
      slug: "upi-payments-for-d2c-stores", headline: "Take UPI payments on your store this week",
      pitch: "Paytm-powered UPI, cards and payment links for direct-to-consumer brands, with instant settlement reports. We set it up with you.",
      landing_visits: 0,
    },
    {
      id: 4, name: "Wholesale catalogue mailer", channel: "email", status: "paused", budget: 8000, spend: 8000, impressions: 12500, clicks: 410, started_at: daysAgo(20),
      slug: "wholesale-catalogue-mailer", headline: "ShopKart's wholesale catalogue, at trade prices",
      pitch: "Stock up on ShopKart's best sellers at wholesale prices: audio, wearables, bags and home goods, with GST invoices and doorstep delivery.",
      landing_visits: 0,
    },
  ];
}

/**
 * The request forms a new workspace starts with. Configuration, not demo data: the team edits them in the
 * Control Room, `ensureResolveAIConfig` adds any that are missing on API start, and reset keeps them.
 */
export function buildForms(): InfoForm[] {
  const updated_at = new Date().toISOString();
  return [
    {
      id: "damaged_item",
      title: "Damaged or wrong item",
      ask: "Sorry about that! Tell us which order it is and what went wrong.",
      use_for: "A damaged, broken, wrong or incomplete item, when it isn't clear which order it is or what went wrong.",
      active: true,
      updated_at,
      fields: [
        { key: "order", kind: "order", label: "Which order?", enabled: true, required: true },
        { key: "problem", kind: "choice", label: "What went wrong?", enabled: true, required: true, options: ["Arrived broken", "Wrong item", "Parts missing", "Not as described"] },
        { key: "photo", kind: "photo", label: "Photo of the item", enabled: true, required: false },
        { key: "note", kind: "text", label: "Anything else we should know?", enabled: false, required: false },
      ],
    },
    {
      id: "payment_problem",
      title: "Payment problem",
      ask: "Let's sort out your payment. Pick the order and share the bank reference from your SMS or UPI app.",
      use_for: "Money was debited but the order shows unpaid or failed, and you need the order or the bank reference (UTR).",
      active: true,
      updated_at,
      fields: [
        { key: "order", kind: "order", label: "Which order?", enabled: true, required: true },
        { key: "method", kind: "choice", label: "How did you pay?", enabled: true, required: true, options: ["UPI", "Card", "Net banking", "Wallet"] },
        { key: "utr", kind: "text", label: "Bank reference (UTR)", enabled: true, required: false },
        { key: "screenshot", kind: "photo", label: "Screenshot of the debit", enabled: false, required: false },
      ],
    },
    {
      id: "delivery_issue",
      title: "Delivery issue",
      ask: "Which order is it, and what happened with the delivery?",
      use_for: "A late, missing or wrongly delivered order, when it isn't clear which order it is.",
      active: true,
      updated_at,
      fields: [
        { key: "order", kind: "order", label: "Which order?", enabled: true, required: true },
        { key: "problem", kind: "choice", label: "What happened?", enabled: true, required: true, options: ["It's late", "Shows delivered, not received", "Box was opened"] },
        { key: "note", kind: "text", label: "Anything else we should know?", enabled: true, required: false },
      ],
    },
  ];
}

async function writeCampaigns(tx: Tx) {
  await tx.insert(s.campaigns).values(buildCampaigns().map((c) => ({ ...c, started_at: date(c.started_at) })));
  await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('campaigns', 'id'), (select max(id) from campaigns))`));
}

async function write(tx: Tx) {
  const d = build();
  await tx.insert(s.customers).values(d.customers);
  await tx.insert(s.products).values(d.products);
  await tx.insert(s.orders).values(d.orders.map((o) => ({ ...o, placed_at: date(o.placed_at), updated_at: date(o.updated_at) })));
  await tx.insert(s.zdUsers).values(d.zdUsers);
  for (const [table, last] of Object.entries(d.next)) {
    await tx.execute(sql`select setval(pg_get_serial_sequence(${table}, 'id'), ${last})`);
  }
  // Tables with no fixed continuation point carry on after their highest seeded id.
  for (const table of ["customers", "products", "orders"]) {
    await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${table}', 'id'), (select max(id) from ${table}))`));
  }
  await writeCampaigns(tx);
}

/**
 * The agent service's own tables (apps/agent): VoltAgent's conversation memory (voltagent_*) and the chat →
 * ticket map. They are created by the agent, so they may not exist yet; found by name.
 */
export async function agentMemoryTables(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = current_schema() and (tablename like 'voltagent!_%' escape '!' or tablename = 'agent_chat_sessions') order by tablename`,
  );
  return [...rows].map((r) => r.tablename);
}

/** Wipes every demo table and the agents' memory, then writes the seed data again. */
export async function resetDemoData(db: Db) {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`truncate ${s.DEMO_TABLES.join(", ")} restart identity cascade`));
    // A fresh demo starts with no remembered chats, leads or analysis notes.
    const agent = await agentMemoryTables(tx);
    if (agent.length) await tx.execute(sql.raw(`truncate ${agent.map((t) => `"${t}"`).join(", ")}`));
    await write(tx);
  });
}

/** Seeds the demo data if the database has none yet. Returns true when it seeded. */
export async function ensureSeeded(db: Db): Promise<boolean> {
  const [[row], [campaigns]] = await Promise.all([db.select({ n: count() }).from(s.customers), db.select({ n: count() }).from(s.campaigns)]);
  if (row && row.n > 0) {
    // Seeded before campaigns existed: add just those, keep everything else.
    if (!campaigns?.n) await db.transaction(writeCampaigns);
    return false;
  }
  await resetDemoData(db);
  return true;
}

/** The Control Room's settings until someone changes them (rai_settings, id "default"). */
export const DEFAULT_SETTINGS: Settings = {
  agentName: "Aria",
  avatarColor: "#0F9D8A",
  tone: "Friendly",
  playbooks: { support: true, sales: true },
  autonomy: "approval",
  refundLimit: 1000,
  verifiedDamageLimit: 1000,
  requireDamagePhotos: true,
  escalation: { fraud: true, legal: true, vip: false, negative: true },
  languages: ["English", "Hindi", "Hinglish"],
  hours: { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], from: "09:00", to: "21:00", afterHours: "autonomous" },
};

/**
 * ResolveAI's config rows: the channels (ShopKart chat, Aria voice calls, the business enquiry form), the
 * connectors (three demo tools + Sarvam), the default Control Room settings and the request forms. Only inserts
 * missing rows, so URLs, tokens, settings and forms people changed survive restarts and demo resets.
 */
export async function ensureResolveAIConfig(db: Db, apiOrigin: string) {
  await Promise.all([
    db
      .insert(s.channels)
      .values([
        { id: "shopkart", name: "ShopKart chat", kind: "chat" },
        { id: "sarvam_voice", name: "Aria voice calls", kind: "voice" },
        { id: "enquiry_form", name: "ShopKart business enquiry", kind: "form" },
      ])
      .onConflictDoNothing(),
    db
      .insert(s.connectors)
      .values([
        { id: "zendesk", name: "Zendesk", category: "Helpdesk", base_url: `${apiOrigin}/zendesk` },
        { id: "shop", name: "ShopKart + Paytm", category: "Orders & payments", base_url: `${apiOrigin}/shop` },
        { id: "hubspot", name: "HubSpot CRM", category: "CRM", base_url: `${apiOrigin}/crm` },
        { id: "sarvam", name: "Sarvam Voice", category: "Voice", base_url: "https://apps.sarvam.ai", enabled: true },
      ])
      .onConflictDoNothing(),
    db.insert(s.settings).values({ id: "default", value: DEFAULT_SETTINGS }).onConflictDoNothing(),
    db
      .insert(s.infoForms)
      .values(buildForms().map((f, position) => ({ ...f, position, updated_at: date(f.updated_at) })))
      .onConflictDoNothing(),
  ]);
  await addMissingSettings(db);
}

/**
 * Settings fields added after a row was saved get their default written in (top level and inside escalation /
 * hours). Values people set are never touched; escalation switches that no longer exist are dropped.
 */
async function addMissingSettings(db: Db) {
  const [row] = await db.select().from(s.settings).where(eq(s.settings.id, "default"));
  if (!row) return;
  const v = (typeof row.value === "string" ? JSON.parse(row.value) : row.value) as Partial<Settings> & { escalation?: Record<string, boolean> };
  const known = Object.keys(DEFAULT_SETTINGS.escalation);
  const next: Settings = {
    ...DEFAULT_SETTINGS,
    ...v,
    escalation: { ...DEFAULT_SETTINGS.escalation, ...Object.fromEntries(Object.entries(v.escalation ?? {}).filter(([k]) => known.includes(k))) },
    hours: { ...DEFAULT_SETTINGS.hours, ...(v.hours ?? {}) },
  } as Settings;
  if (JSON.stringify(next) !== JSON.stringify(v)) await db.update(s.settings).set({ value: next, updated_at: new Date() }).where(eq(s.settings.id, "default"));
}
