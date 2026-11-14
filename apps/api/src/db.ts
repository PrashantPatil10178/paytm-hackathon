import {
  BOT,
  type Activity,
  type Contact,
  type Customer,
  type Deal,
  type Order,
  type Product,
  type Ticket,
  type ZdComment,
  type ZdUser,
} from "@ph/shared";

/** In-memory demo database. Seeded relative to "now" so the screens always look recent.
 *  POST /admin/reset re-seeds it between demo runs. */
export interface DB {
  zdUsers: ZdUser[];
  tickets: Ticket[];
  contacts: Contact[];
  deals: Deal[];
  activities: Map<number, Activity[]>; // deal id → activity
  products: Product[];
  customers: Customer[];
  orders: Order[];
  chatSessions: Map<string, number>; // session id → ticket id
  seq: { ticket: number; comment: number; contact: number; deal: number; activity: number; meeting: number; task: number; user: number };
}

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

export function seed(): DB {
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
    chatSessions: new Map(),
    seq: { ticket: 2040, comment: commentId, contact: 8, deal: 8, activity: activityId, meeting: 1, task: 1, user: 300 },
  };
}

export let db: DB = seed();
export function reset() {
  db = seed();
}
