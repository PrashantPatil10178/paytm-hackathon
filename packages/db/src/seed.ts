/**
 * The demo data. Seeded relative to "now" so the screens always look recent. `resetDemoData` wipes the
 * demo tables and writes it again (POST /admin/reset, `bun run reset`); `ensureSeeded` does it only
 * when the database is empty (API startup).
 */
import {
  BOT,
  type Activity,
  type Campaign,
  type CampaignResponse,
  type Contact,
  type Customer,
  type Deal,
  type InfoForm,
  type Order,
  type Product,
  type Ticket,
  type ZdComment,
  type ZdUser,
} from "@ph/shared";
import { count, sql } from "drizzle-orm";
import type { Db, Tx } from "./client.ts";
import * as s from "./schema.ts";

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const hoursAgo = (h: number) => minsAgo(h * 60);
const daysAgo = (d: number) => minsAgo(d * 24 * 60);

function daysFromNow(d: number, hour = 11): string {
  const t = new Date();
  t.setDate(t.getDate() + d);
  while (t.getDay() === 0 || t.getDay() === 6) t.setDate(t.getDate() + 1);
  t.setHours(hour, 0, 0, 0);
  return t.toISOString();
}

function build() {
  /* ───── ShopKart ───── */
  const customers: Customer[] = [
    { id: 101, name: "Rohan Mehta", email: "rohan.mehta@mail.example", phone: "+91 90000 10101", city: "Pune" },
    { id: 102, name: "Ananya Iyer", email: "ananya.iyer@mail.example", phone: "+91 90000 10102", city: "Bengaluru" },
    { id: 103, name: "Vikram Singh", email: "vikram.singh@mail.example", phone: "+91 90000 10103", city: "New Delhi" },
    { id: 104, name: "Sneha Kulkarni", email: "sneha.k@mail.example", phone: "+91 90000 10104", city: "Mumbai" },
    { id: 105, name: "Arjun Nair", email: "arjun.nair@mail.example", phone: "+91 90000 10105", city: "Kochi" },
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
    // Refund demo: delivered, then reported damaged. ₹500.
    order(1023, 102, [line(8)], "damaged", "paid", 6),
    order(1027, 104, [line(7, 2)], "delivered", "paid", 12),
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

  /* ───── Zendesk ───── */
  const zdUsers: ZdUser[] = [
    ...customers.map(({ id, name, email, phone }) => ({ id, name, email, phone })),
    { id: 201, name: "Kavya Reddy", email: "kavya.reddy@mail.example", phone: "+91 90000 20201" },
    { id: 202, name: "Imran Shaikh", email: "imran.s@mail.example", phone: "+91 90000 20202" },
    { id: 203, name: "Deepa Menon", email: "deepa@menoncrafts.example", phone: "+91 90000 20203" },
  ];
  const u = (id: number) => zdUsers.find((x) => x.id === id)!;

  let commentId = 9000;
  type C = [author: string, type: ZdComment["author_type"], body: string, pub: boolean, at: string];
  const thread = (cs: C[]): ZdComment[] =>
    cs.map(([author, author_type, body, pub, created_at]) => ({ id: ++commentId, author, author_type, body, public: pub, created_at }));

  const t = (
    id: number,
    subject: string,
    requester: number,
    status: Ticket["status"],
    priority: Ticket["priority"],
    type: Ticket["type"],
    assignee: string | null,
    extra: Partial<Ticket> & { thread: C[] },
  ): Ticket => {
    const comments = thread(extra.thread);
    const { thread: _, ...rest } = extra;
    return {
      id,
      subject,
      status,
      priority,
      type,
      requester: u(requester),
      assignee,
      escalated_by_ai: false,
      tags: [],
      via: "email",
      order_id: null,
      csat: null,
      created_at: comments[0]!.created_at,
      updated_at: comments.at(-1)!.created_at,
      comments,
      ...rest,
    };
  };

  const tickets: Ticket[] = [
    t(2031, "Wrong size T-shirt delivered", 104, "solved", "low", "incident", "Karan – Support", {
      tags: ["exchange", "fashion"], order_id: 1027, csat: 5,
      thread: [
        ["Sneha Kulkarni", "customer", "I ordered M but both T-shirts in order #1027 are XL. Can I exchange them?", true, daysAgo(4)],
        ["Karan – Support", "agent", "Sorry about that, Sneha. I've booked a free pickup for tomorrow and the size M pair ships the same day.", true, daysAgo(4)],
        ["Sneha Kulkarni", "customer", "Got them today, thanks!", true, daysAgo(2)],
      ],
    }),
    t(2032, "How do I change my delivery address?", 101, "solved", "low", "question", BOT, {
      via: "chat", tags: ["address"],
      thread: [
        ["Rohan Mehta", "customer", "How do I change the delivery address for order #1034?", true, daysAgo(2)],
        ["ResolveAI Bot", "bot", "Order #1034 has already shipped, so the address can't be changed online. I've asked the courier to hold it at the Pune hub for 3 days. You can collect it there or reschedule delivery from the SMS link.", true, daysAgo(2)],
      ],
    }),
    t(2033, "Refund not received for order #1047", 105, "pending", "normal", "incident", "Priya – Support", {
      via: "chat", tags: ["refund", "payments"], order_id: 1047, escalated_by_ai: true,
      thread: [
        ["Arjun Nair", "customer", "You said my refund for #1047 was done 8 days ago. Nothing in my account yet.", true, hoursAgo(26)],
        ["ResolveAI Bot", "bot", "Your ₹2,499 refund left us on 6 Nov. Bank refunds can take up to 7 working days, so I've passed this to our payments team to chase the bank reference.", true, hoursAgo(26)],
        ["ResolveAI Bot", "bot", "Gateway shows refund REF-88213 settled on our side. Customer is past the 7-day window, so a human needs to raise it with the acquiring bank.", false, hoursAgo(26)],
        ["Priya – Support", "agent", "Raised with the bank. Waiting on their ARN.", false, hoursAgo(20)],
      ],
    }),
    t(2034, "GST number missing on my invoice", 201, "open", "normal", "question", "Karan – Support", {
      tags: ["invoice", "gst"],
      thread: [
        ["Kavya Reddy", "customer", "My invoice doesn't show our company GSTIN. I need it for input credit.", true, hoursAgo(5)],
      ],
    }),
    t(2035, "Coupon FESTIVE20 not applying at checkout", 202, "new", "low", "question", null, {
      via: "web", tags: ["coupon"],
      thread: [["Imran Shaikh", "customer", "FESTIVE20 says 'not applicable' on a ₹1,800 cart. The banner says it works above ₹1,500.", true, hoursAgo(3)]],
    }),
    t(2036, "Backpack zip broke after a week", 103, "open", "normal", "problem", BOT, {
      via: "chat", tags: ["quality", "bags"], order_id: 1041,
      thread: [
        ["Vikram Singh", "customer", "The main zip on my backpack from #1041 has split.", true, hoursAgo(2)],
        ["ResolveAI Bot", "bot", "Sorry about that. The backpack has a 6-month warranty. Could you share a photo of the zip so I can arrange a replacement?", true, hoursAgo(2)],
      ],
    }),
    t(2037, "Where is my order #1031?", 105, "solved", "low", "question", BOT, {
      via: "chat", tags: ["wismo"], order_id: 1031,
      thread: [
        ["Arjun Nair", "customer", "Where is my order #1031?", true, minsAgo(95)],
        ["ResolveAI Bot", "bot", "Order #1031 shipped yesterday and is at the Kochi hub. It's out for delivery tomorrow before 7 pm.", true, minsAgo(94)],
      ],
    }),
    t(2038, "Need a GST invoice for a bulk order", 203, "pending", "normal", "question", "Priya – Support", {
      tags: ["bulk", "invoice"],
      thread: [
        ["Deepa Menon", "customer", "We're ordering 40 bottles for a workshop. Can the invoice be in our firm's name?", true, daysAgo(1)],
        ["Priya – Support", "agent", "Yes. Please share your GSTIN and billing address and we'll issue it before dispatch.", true, hoursAgo(20)],
      ],
    }),
    t(2039, "OTP not arriving, can't log in", 201, "new", "high", "incident", null, {
      via: "web", tags: ["login", "otp"],
      thread: [["Kavya Reddy", "customer", "I've requested the login OTP five times and nothing comes through.", true, minsAgo(40)]],
    }),
    t(2040, "Exchange smartwatch strap colour", 104, "open", "low", "question", BOT, {
      via: "chat", tags: ["exchange", "wearables"], order_id: 1056,
      thread: [
        ["Sneha Kulkarni", "customer", "Can I swap the white strap on order #1056 for black?", true, minsAgo(25)],
        ["ResolveAI Bot", "bot", "Yes. Once it's delivered, start an exchange from My Orders and choose Black. The strap swap is free.", true, minsAgo(24)],
      ],
    }),
  ];

  /* ───── HubSpot CRM ───── */
  const contacts: Contact[] = [
    { id: 1, name: "Rakesh Sharma", email: "rakesh@sharmarestaurants.example", phone: "+91 90000 30001", company: "Sharma Restaurants", lead_status: "Open deal", owner: BOT, source: "Business enquiry form", created_at: daysAgo(3) },
    { id: 2, name: "Neha Gupta", email: "neha@guptasweets.example", phone: "+91 90000 30002", company: "Gupta Sweets & Snacks", lead_status: "Open deal", owner: "Rahul – Sales", source: "Referral", created_at: daysAgo(9) },
    { id: 3, name: "Farhan Qureshi", email: "farhan@qureshielectronics.example", phone: "+91 90000 30003", company: "Qureshi Electronics", lead_status: "New", owner: BOT, source: "Business enquiry form", created_at: hoursAgo(6) },
    { id: 4, name: "Lakshmi Narayanan", email: "lakshmi@lntextiles.example", phone: "+91 90000 30004", company: "LN Textiles", lead_status: "In progress", owner: "Meera – Sales", source: "Import", created_at: daysAgo(6) },
    { id: 5, name: "Aditi Joshi", email: "aditi@joshipharma.example", phone: "+91 90000 30005", company: "Joshi Pharma Distributors", lead_status: "In progress", owner: BOT, source: "Chat", created_at: daysAgo(2) },
    { id: 6, name: "Manpreet Kaur", email: "manpreet@kaurfitness.example", phone: "+91 90000 30006", company: "Kaur Fitness Studio", lead_status: "Connected", owner: "Rahul – Sales", source: "Business enquiry form", created_at: daysAgo(14) },
    { id: 7, name: "Siddharth Rao", email: "sid@raologistics.example", phone: "+91 90000 30007", company: "Rao Logistics", lead_status: "Unqualified", owner: "Meera – Sales", source: "Import", created_at: daysAgo(20) },
    { id: 8, name: "Ishaan Kapoor", email: "ishaan@cafemocha.example", phone: "+91 90000 30008", company: "Café Mocha, Pune", lead_status: "New", owner: BOT, source: "Chat", created_at: hoursAgo(3) },
  ];

  const deal = (d: Omit<Deal, "meeting" | "quote" | "payment_link" | "tasks" | "updated_at"> & Partial<Deal>): Deal => ({
    meeting: null,
    quote: null,
    payment_link: null,
    tasks: [],
    updated_at: d.created_at,
    ...d,
  });

  const deals: Deal[] = [
    deal({
      id: 1, name: "Sharma Restaurants – Billing setup", amount: 48000, stage: "meeting_booked", contact_id: 1, owner: BOT, score: "hot",
      next_step: "POS billing demo on the booked call", close_date: daysFromNow(10), created_at: daysAgo(3), updated_at: hoursAgo(20),
      meeting: { id: 1, deal_id: 1, title: "Billing setup demo – Sharma Restaurants", start: daysFromNow(1, 15), duration_min: 30, attendees: ["Rakesh Sharma", "Rahul – Sales"] },
      tasks: [{ id: 1, title: "Send the 3-outlet pricing sheet before the call", due: daysFromNow(1, 12), done: false }],
    }),
    deal({
      id: 2, name: "Gupta Sweets – Diwali gift boxes", amount: 120000, stage: "quote_sent", contact_id: 2, owner: "Rahul – Sales", score: "warm",
      next_step: "Follow up on the quote", close_date: daysFromNow(5), created_at: daysAgo(9), updated_at: daysAgo(1),
      quote: { items: [{ name: "Corporate gift box (assorted)", qty: 200, unit_price: 550 }, { name: "Custom sleeve printing", qty: 200, unit_price: 50 }], amount: 120000, status: "sent", updated_at: daysAgo(1) },
      payment_link: "https://pay.shopkart.example/q/GS-120000",
    }),
    deal({
      id: 3, name: "Qureshi Electronics – Payment setup", amount: 35000, stage: "new_lead", contact_id: 3, owner: BOT, score: "warm",
      next_step: "Qualify: monthly volume and current gateway", close_date: daysFromNow(21), created_at: hoursAgo(6),
    }),
    deal({
      id: 4, name: "LN Textiles – Bulk uniform order", amount: 240000, stage: "qualified", contact_id: 4, owner: "Meera – Sales", score: "hot",
      next_step: "Book a fabric sampling meeting", close_date: daysFromNow(14), created_at: daysAgo(6), updated_at: daysAgo(2),
    }),
    deal({
      id: 5, name: "Joshi Pharma – Billing setup", amount: 60000, stage: "qualified", contact_id: 5, owner: BOT, score: "cold",
      next_step: "Confirm GST e-invoicing need", close_date: daysFromNow(30), created_at: daysAgo(2), updated_at: daysAgo(1),
    }),
    deal({
      id: 6, name: "Kaur Fitness – Payment setup", amount: 18000, stage: "closed_won", contact_id: 6, owner: "Rahul – Sales", score: "warm",
      next_step: "Onboarding call", close_date: daysAgo(3), created_at: daysAgo(14), updated_at: daysAgo(3),
      quote: { items: [{ name: "Payment gateway setup", qty: 1, unit_price: 12000 }, { name: "QR standees", qty: 6, unit_price: 1000 }], amount: 18000, status: "sent", updated_at: daysAgo(5) },
      payment_link: "https://pay.shopkart.example/q/KF-18000",
    }),
    deal({
      id: 7, name: "Rao Logistics – Payment setup", amount: 75000, stage: "closed_lost", contact_id: 7, owner: "Meera – Sales", score: "cold",
      next_step: "Revisit next quarter", close_date: daysAgo(6), created_at: daysAgo(20), updated_at: daysAgo(6),
    }),
    deal({
      id: 8, name: "Café Mocha – Billing setup", amount: 22000, stage: "new_lead", contact_id: 8, owner: BOT, score: "cold",
      next_step: "Ask about number of counters", close_date: daysFromNow(25), created_at: hoursAgo(3),
    }),
  ];

  let activityId = 500;
  const a = (type: Activity["type"], body: string, author: string, at: string): Activity => ({
    id: ++activityId, type, body, author, ai: author === BOT, created_at: at,
  });
  const activities = new Map<number, Activity[]>([
    [1, [
      a("note", "New lead from the business enquiry form. Runs 3 outlets in Pune, wants GST billing on every counter. Budget ₹50,000. Scored Hot: budget fits and they want to start this month.", BOT, daysAgo(3)),
      a("email", "Sent Rakesh our restaurant billing brochure and asked for a call time.", BOT, daysAgo(3)),
      a("stage_change", "Stage moved from New lead to Qualified", BOT, daysAgo(2)),
      a("meeting", "Booked a 30-minute billing setup demo with Rakesh and Rahul.", BOT, hoursAgo(20)),
      a("stage_change", "Stage moved from Qualified to Meeting booked", BOT, hoursAgo(20)),
    ]],
    [2, [
      a("call", "Neha needs 200 gift boxes before Diwali with their logo on the sleeve.", "Rahul – Sales", daysAgo(8)),
      a("quote", "Quote for ₹1,20,000 sent with payment link.", "Rahul – Sales", daysAgo(1)),
    ]],
    [3, [a("note", "Lead from the website form. Wants UPI + card payments on their online store. Budget ₹35,000. Scored Warm: budget OK, no start date yet.", BOT, hoursAgo(6))]],
    [4, [a("call", "Needs 1,200 uniforms for two schools. Wants fabric samples first.", "Meera – Sales", daysAgo(5))]],
    [5, [a("note", "Asked about billing over chat. Small distributor, unsure about timing. Scored Cold.", BOT, daysAgo(2))]],
    [6, [a("stage_change", "Stage moved from Quote sent to Closed won", "Rahul – Sales", daysAgo(3))]],
    [7, [a("note", "Went with their bank's gateway. Revisit next quarter.", "Meera – Sales", daysAgo(6))]],
    [8, [a("note", "Chat enquiry about billing for a single café. Budget ₹22,000. Scored Cold: wants to start in 3 months.", BOT, hoursAgo(3))]],
  ]);

  return {
    zdUsers,
    tickets,
    contacts,
    deals,
    activities,
    products,
    customers,
    orders,
    // Where each id sequence continues from, so new records get the numbers the demo script expects (#2041, …).
    next: { tickets: 2040, ticket_comments: commentId, contacts: 8, deals: 8, deal_activities: activityId, meetings: 1, zd_users: 300 },
  };
}

const date = (iso: string) => new Date(iso);

/* ───── Campaigns: the leads agent's input. Seeded on their own too, so a database seeded before they existed gets them. ───── */

type ResponseSeed = Omit<CampaignResponse, "campaign" | "status" | "contact_id" | "deal_id" | "note" | "processed_at"> & { campaign_id: number };

function buildCampaigns(): { campaigns: Campaign[]; responses: ResponseSeed[] } {
  const campaigns: Campaign[] = [
    { id: 1, name: "Diwali bulk gifting", channel: "meta_ads", status: "active", budget: 60000, spend: 38400, impressions: 182000, clicks: 3640, started_at: daysAgo(12) },
    { id: 2, name: "GST billing for restaurants", channel: "google_ads", status: "active", budget: 40000, spend: 27150, impressions: 64000, clicks: 2180, started_at: daysAgo(9) },
    { id: 3, name: "UPI payments for D2C stores", channel: "whatsapp", status: "active", budget: 15000, spend: 9800, impressions: 21000, clicks: 1460, started_at: daysAgo(6) },
    { id: 4, name: "Wholesale catalogue mailer", channel: "email", status: "paused", budget: 8000, spend: 8000, impressions: 12500, clicks: 410, started_at: daysAgo(20) },
  ];
  let rid = 0;
  const r = (campaign_id: number, x: Omit<ResponseSeed, "id" | "campaign_id">): ResponseSeed => ({ id: ++rid, campaign_id, ...x });
  const responses: ResponseSeed[] = [
    r(1, { name: "Meera Joshi", email: "meera@joshisweets.example", phone: "+91 90000 40001", company: "Joshi Sweets", need: "bulk_order", budget: 90000, start_when: "This week",
      message: "Need 500 Diwali hampers with our logo on the box, delivered by the 28th. Please share pricing.", created_at: hoursAgo(5) }),
    r(1, { name: "Aditya Menon", email: "aditya@brightcorp.example", phone: "+91 90000 40002", company: "BrightCorp IT Services", need: "bulk_order", budget: 45000, start_when: "This month",
      message: "Looking for 150 employee gift boxes for our Diwali party.", created_at: hoursAgo(9) }),
    r(1, { name: "test test", email: "test@test.example", phone: "0000000000", company: "test", need: "other", budget: null, start_when: "",
      message: "test", created_at: hoursAgo(7) }),
    r(2, { name: "Zoya Hussain", email: "zoya@spiceroute.example", phone: "+91 90000 40004", company: "Spice Route Kitchens", need: "billing_setup", budget: 60000, start_when: "Now",
      message: "We run 4 outlets in Hyderabad. Need GST billing and KOT printing on every counter.", created_at: hoursAgo(3) }),
    r(2, { name: "Lakshmi Pillai", email: "lakshmi@pillaitiffins.example", phone: "+91 90000 40005", company: "Pillai Tiffin Centre", need: "billing_setup", budget: 8000, start_when: "In 3 months",
      message: "Single counter. Just want a simple billing app. What is the monthly cost?", created_at: hoursAgo(26) }),
    // Already in the pipeline (contact 1, deal 1 has a meeting booked): the agent should not open a second deal.
    r(2, { name: "Rakesh Sharma", email: "rakesh@sharmarestaurants.example", phone: "+91 90000 30001", company: "Sharma Restaurants", need: "billing_setup", budget: 50000, start_when: "This month",
      message: "Saw your ad. We spoke earlier about billing for our 3 outlets. Still interested.", created_at: hoursAgo(4) }),
    r(2, { name: "Gaurav Sethi", email: "gaurav@sethimedicals.example", phone: "+91 90000 40007", company: "Sethi Medicals", need: "billing_setup", budget: 25000, start_when: "",
      message: "Pharmacy with 2 stores. Need billing with batch and expiry tracking.", created_at: hoursAgo(14) }),
    r(3, { name: "Nikhil Batra", email: "nikhil@urbanthread.example", phone: "+91 90000 40008", company: "UrbanThread", need: "payment_setup", budget: 30000, start_when: "Next month",
      message: "D2C apparel brand, about 800 orders a month on Shopify. Want UPI and cards at checkout.", created_at: hoursAgo(2) }),
    r(4, { name: "Sunita Deshmukh", email: "sunita@deshmukhtraders.example", phone: "+91 90000 40009", company: "Deshmukh Traders", need: "bulk_order", budget: 120000, start_when: "This month",
      message: "Please send the wholesale price list for steel bottles. We need about 1,000 units.", created_at: daysAgo(2) }),
    r(4, { name: "Promo Blast", email: "noreply@promo-blast.example", phone: "", company: "", need: "other", budget: null, start_when: "",
      message: "WIN a FREE iPhone!!! Click bit.ly/xx-claim to claim your prize now", created_at: daysAgo(1) }),
  ];
  return { campaigns, responses };
}

/** The request forms a new workspace starts with. The team edits them in the Control Room. */
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

async function writeForms(tx: Tx) {
  await tx.insert(s.infoForms).values(buildForms().map((f, position) => ({ ...f, position, updated_at: date(f.updated_at) })));
}

async function writeCampaigns(tx: Tx) {
  const { campaigns, responses } = buildCampaigns();
  await tx.insert(s.campaigns).values(campaigns.map((c) => ({ ...c, started_at: date(c.started_at) })));
  await tx.insert(s.campaignResponses).values(responses.map((x) => ({ ...x, created_at: date(x.created_at) })));
  for (const table of ["campaigns", "campaign_responses"]) {
    await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${table}', 'id'), (select max(id) from ${table}))`));
  }
}

async function write(tx: Tx) {
  const d = build();
  await tx.insert(s.customers).values(d.customers);
  await tx.insert(s.products).values(d.products);
  await tx.insert(s.orders).values(d.orders.map((o) => ({ ...o, placed_at: date(o.placed_at), updated_at: date(o.updated_at) })));
  await tx.insert(s.zdUsers).values(d.zdUsers);
  await tx.insert(s.tickets).values(
    d.tickets.map(({ comments: _, requester, ...t }) => ({ ...t, requester_id: requester.id, created_at: date(t.created_at), updated_at: date(t.updated_at) })),
  );
  await tx.insert(s.ticketComments).values(d.tickets.flatMap((t) => t.comments.map((c) => ({ ...c, ticket_id: t.id, created_at: date(c.created_at) }))));
  await tx.insert(s.contacts).values(d.contacts.map((c) => ({ ...c, created_at: date(c.created_at) })));
  await tx.insert(s.deals).values(
    d.deals.map(({ meeting: _, ...x }) => ({ ...x, close_date: date(x.close_date), created_at: date(x.created_at), updated_at: date(x.updated_at) })),
  );
  const meetings = d.deals.flatMap((x) => (x.meeting ? [{ ...x.meeting, start: date(x.meeting.start) }] : []));
  if (meetings.length) await tx.insert(s.meetings).values(meetings);
  await tx.insert(s.activities).values([...d.activities].flatMap(([deal_id, list]) => list.map((a) => ({ ...a, deal_id, created_at: date(a.created_at) }))));
  for (const [table, last] of Object.entries(d.next)) {
    await tx.execute(sql`select setval(pg_get_serial_sequence(${table}, 'id'), ${last})`);
  }
  // Tables with no fixed continuation point carry on after their highest seeded id.
  for (const table of ["customers", "products", "orders"]) {
    await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${table}', 'id'), (select max(id) from ${table}))`));
  }
  await writeCampaigns(tx);
  await writeForms(tx);
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
  const [[row], [campaigns], [forms]] = await Promise.all([
    db.select({ n: count() }).from(s.customers),
    db.select({ n: count() }).from(s.campaigns),
    db.select({ n: count() }).from(s.infoForms),
  ]);
  if (row && row.n > 0) {
    // Seeded before campaigns or request forms existed: add just those, keep everything else.
    if (!campaigns?.n) await db.transaction(writeCampaigns);
    if (!forms?.n) await db.transaction(writeForms);
    return false;
  }
  await resetDemoData(db);
  return true;
}
