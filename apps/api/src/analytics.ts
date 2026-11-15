/**
 * Live numbers for the Control Room's Analytics page and the analysis agent. Everything is computed
 * from Postgres on request, so the charts can never disagree with the demo apps. The agent only writes
 * findings about these datasets (POST /analytics/reports); it never supplies numbers for a chart.
 */
import {
  ANALYTICS_DATASETS,
  BOT,
  CAMPAIGN_CHANNELS,
  DEAL_STAGES,
  SALES_DATASETS,
  type AnalysisInsight,
  type AnalysisReport,
  type AnalysisScope,
  type AnalyticsDataset,
  type AnalyticsDatasetId,
  type AnalyticsMetrics,
  type AnalyticsSeries,
  type CreateReportBody,
} from "@ph/shared";
import { desc, eq, schema as s, toReport } from "@ph/db";
import { listCampaigns } from "./campaigns.ts";
import { db } from "./db.ts";
import { bad, body, handle, ok, oneOf } from "./http.ts";

const DAYS = 14;
const TZ = "Asia/Kolkata";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD in IST
const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: TZ });

/** The last 14 IST days, oldest first. */
function lastDays(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    out.push({ key: dayKey(d), label: dayLabel(d) });
  }
  return out;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1).replace(/_/g, " ");

function dataset(id: AnalyticsDatasetId, series: AnalyticsSeries[], rows: AnalyticsDataset["rows"]): AnalyticsDataset {
  const meta = ANALYTICS_DATASETS.find((d) => d.id === id)!;
  return { id, title: meta.title, description: meta.description, series, rows };
}

/** Rows for fixed categories, in order, with zero rows kept so bars line up between runs. */
function byCategory<T>(items: T[], categories: { key: string; label: string }[], keyOf: (x: T) => string, values: Record<string, (xs: T[]) => number>) {
  return categories.map((c) => {
    const mine = items.filter((x) => keyOf(x) === c.key);
    return { key: c.key, label: c.label, ...Object.fromEntries(Object.entries(values).map(([k, f]) => [k, f(mine)])) };
  });
}

const n = (xs: unknown[]) => xs.length;
const sum = <T>(f: (x: T) => number) => (xs: T[]) => Math.round(xs.reduce((a, x) => a + f(x), 0));

export async function computeMetrics(): Promise<AnalyticsMetrics> {
  const [tickets, orders, deals, contacts, campaigns] = await Promise.all([
    db.select({ status: s.tickets.status, priority: s.tickets.priority, assignee: s.tickets.assignee, escalated: s.tickets.escalated_by_ai, created_at: s.tickets.created_at }).from(s.tickets),
    db.select({ amount: s.orders.amount, status: s.orders.status, payment: s.orders.payment_status, placed_at: s.orders.placed_at }).from(s.orders),
    db.select({ stage: s.deals.stage, amount: s.deals.amount, score: s.deals.score }).from(s.deals),
    db.select({ source: s.contacts.source }).from(s.contacts),
    listCampaigns(),
  ]);

  type T = (typeof tickets)[number];
  type O = (typeof orders)[number];
  type D = (typeof deals)[number];
  const byAi = (t: T) => t.assignee === BOT && !t.escalated;
  // Money that actually came in: not refunded, not stuck in a failed payment.
  const counted = (o: O) => o.payment !== "refunded" && o.payment !== "refund_initiated" && o.payment !== "failed_debited";
  const open = (d: D) => d.stage !== "closed_won" && d.stage !== "closed_lost";

  const days = lastDays();
  const since = new Set(days.map((d) => d.key));
  const recentTickets = tickets.filter((t) => since.has(dayKey(t.created_at)));
  const recentOrders = orders.filter((o) => since.has(dayKey(o.placed_at)));

  const COUNT = (key: string, label: string): AnalyticsSeries => ({ key, label, unit: "count" });
  const INR = (key: string, label: string): AnalyticsSeries => ({ key, label, unit: "inr" });

  const datasets: AnalyticsDataset[] = [
    dataset("tickets_per_day", [COUNT("ai", "Handled by AI"), COUNT("human", "Handled by people")],
      byCategory(recentTickets, days, (t) => dayKey(t.created_at), { ai: (xs) => xs.filter(byAi).length, human: (xs) => xs.filter((t) => !byAi(t)).length })),
    dataset("tickets_by_status", [COUNT("tickets", "Tickets")],
      byCategory(tickets, ["new", "open", "pending", "solved"].map((k) => ({ key: k, label: cap(k) })), (t) => t.status, { tickets: n })),
    dataset("tickets_by_priority", [COUNT("tickets", "Tickets")],
      byCategory(tickets, ["low", "normal", "high", "urgent"].map((k) => ({ key: k, label: cap(k) })), (t) => t.priority, { tickets: n })),
    dataset("orders_per_day", [COUNT("orders", "Orders"), INR("revenue", "Revenue")],
      byCategory(recentOrders, days, (o) => dayKey(o.placed_at), { orders: n, revenue: (xs) => sum<O>((o) => o.amount)(xs.filter(counted)) })),
    dataset("orders_by_status", [COUNT("orders", "Orders"), INR("value", "Value")],
      byCategory(orders, ["placed", "shipped", "delivered", "damaged"].map((k) => ({ key: k, label: cap(k) })), (o) => o.status, { orders: n, value: sum<O>((o) => o.amount) })),
    dataset("deals_by_stage", [COUNT("deals", "Deals"), INR("value", "Value")],
      byCategory(deals, DEAL_STAGES.map((x) => ({ key: x.id, label: x.label })), (d) => d.stage, { deals: n, value: sum<D>((d) => d.amount) })),
    dataset("pipeline_by_score", [COUNT("deals", "Open deals"), INR("value", "Value")],
      byCategory(deals.filter(open), ["hot", "warm", "cold"].map((k) => ({ key: k, label: cap(k) })), (d) => d.score, { deals: n, value: sum<D>((d) => d.amount) })),
    dataset("campaign_performance", [INR("spend", "Spend"), COUNT("clicks", "Clicks"), COUNT("responses", "Responses"), COUNT("leads", "Leads created")],
      campaigns.map((c) => ({ key: String(c.id), label: c.name, channel: CAMPAIGN_CHANNELS.find((x) => x.id === c.channel)?.label ?? c.channel, spend: c.spend, clicks: c.clicks, responses: c.responses, leads: c.converted }))),
    dataset("contacts_by_source", [COUNT("contacts", "Contacts")],
      byCategory(contacts, ["Business enquiry form", "Campaign", "Chat", "Referral", "Import"].map((k) => ({ key: k, label: k })), (c) => c.source, { contacts: n })),
  ];

  const ai = tickets.filter(byAi).length;
  const spend = campaigns.reduce((a, c) => a + c.spend, 0);
  const leads = campaigns.reduce((a, c) => a + c.converted, 0);
  return {
    generated_at: new Date().toISOString(),
    totals: {
      tickets: tickets.length,
      tickets_open: tickets.filter((t) => t.status !== "solved").length,
      tickets_solved: tickets.filter((t) => t.status === "solved").length,
      tickets_ai: ai,
      tickets_escalated: tickets.filter((t) => t.escalated).length,
      ai_rate: tickets.length ? Math.round((ai / tickets.length) * 1000) / 10 : 0,
      orders_14d: recentOrders.length,
      revenue_14d: Math.round(recentOrders.filter(counted).reduce((a, o) => a + o.amount, 0)),
      refunds: orders.filter((o) => o.payment === "refunded" || o.payment === "refund_initiated").length,
      deals_open: deals.filter(open).length,
      pipeline_open: Math.round(deals.filter(open).reduce((a, d) => a + d.amount, 0)),
      won_value: Math.round(deals.filter((d) => d.stage === "closed_won").reduce((a, d) => a + d.amount, 0)),
      hot_open: deals.filter((d) => open(d) && d.score === "hot").length,
      campaign_spend: Math.round(spend),
      campaign_responses: campaigns.reduce((a, c) => a + c.responses, 0),
      campaign_leads: leads,
      cost_per_lead: leads ? Math.round(spend / leads) : null,
    },
    datasets,
  };
}

/* ───── Reports ───── */

const DATASET_IDS = ANALYTICS_DATASETS.map((d) => d.id);
const TONES = ["good", "watch", "risk"] as const;
const SCOPES = ["all", "sales"] as const;
/** The datasets a report of this scope may write about. */
export const datasetsFor = (scope: AnalysisScope) => (scope === "sales" ? SALES_DATASETS : DATASET_IDS);

export async function saveReport(b: CreateReportBody): Promise<AnalysisReport> {
  const scope = b.scope ? oneOf(b.scope, SCOPES, "scope") : "all";
  const allowed = datasetsFor(scope);
  const headline = b.headline?.trim();
  if (!headline) throw bad("headline is required");
  if (!Array.isArray(b.insights) || b.insights.length < 1 || b.insights.length > 8) throw bad("insights must list 1 to 8 findings");
  const insights: AnalysisInsight[] = b.insights.map((i, n) => {
    if (!i?.title?.trim() || !i?.finding?.trim()) throw bad(`insights[${n}] needs a title and a finding`);
    return { dataset: oneOf(i.dataset, allowed, `insights[${n}].dataset (${scope} report)`), title: i.title.trim().slice(0, 80), finding: i.finding.trim().slice(0, 400), tone: oneOf(i.tone, TONES, `insights[${n}].tone`) };
  });
  // The report keeps the totals it was written against, so its numbers still make sense later.
  const { totals } = await computeMetrics();
  const [row] = await db
    .insert(s.analysisReports)
    .values({ scope, headline: headline.slice(0, 200), insights, author: b.author?.trim() || BOT, snapshot: totals, created_at: new Date() })
    .returning();
  return toReport(row!);
}

export async function latestReports(limit = 10, scope?: AnalysisScope): Promise<AnalysisReport[]> {
  const rows = await db
    .select()
    .from(s.analysisReports)
    .where(scope ? eq(s.analysisReports.scope, scope) : undefined)
    .orderBy(desc(s.analysisReports.created_at), desc(s.analysisReports.id))
    .limit(limit);
  return rows.map(toReport);
}

const scopeParam = (req: Request) => {
  const v = new URL(req.url).searchParams.get("scope");
  return v ? oneOf(v, SCOPES, "scope") : undefined;
};

export const analyticsRoutes = {
  "/analytics/metrics": {
    GET: handle(async () => ok(await computeMetrics())),
  },
  "/analytics/reports": {
    GET: handle(async (req) => ok({ reports: await latestReports(10, scopeParam(req)) })),
    POST: handle(async (req) => ok(await saveReport(await body<CreateReportBody>(req)), 201)),
  },
  "/analytics/reports/latest": {
    GET: handle(async (req) => ok({ report: (await latestReports(1, scopeParam(req)))[0] ?? null })),
  },
};
