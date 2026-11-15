/**
 * Tools for the analysis agent. It reads the live metrics the API computes from Postgres and publishes
 * findings about them. It never supplies chart numbers: the dashboard draws every chart from the same
 * metrics, and a finding can only point at one of the known datasets.
 */
import { ANALYTICS_DATASETS, SALES_DATASETS, type AnalysisScope, type AnalyticsDatasetId, type AnalyticsTotals } from "@ph/shared";
import { createTool } from "@voltagent/core";
import { z } from "zod";
import type { DemoAPI } from "../demo-api.ts";
import { runOf, type AnalysisRun } from "./context.ts";

const DATASET_IDS = ANALYTICS_DATASETS.map((d) => d.id) as [AnalyticsDatasetId, ...AnalyticsDatasetId[]];
const allowed = (scope: AnalysisScope): AnalyticsDatasetId[] => (scope === "sales" ? SALES_DATASETS : DATASET_IDS);

/** Rewrites every ₹ amount with Indian grouping (₹603,000 → ₹6,03,000); models drift to Western grouping. */
export const indianRupees = (text: string) =>
  text.replace(/₹\s?(\d[\d,]*)(\.\d+)?/g, (_m, int: string, frac = "") => `₹${Number(int.replace(/,/g, "")).toLocaleString("en-IN")}${frac}`);

/**
 * The ticket totals in words, from the numbers. Without it the model read "4 AI, 4 escalated" as "the AI escalated
 * all 4 of its tickets", and the working-memory note then carried that into the next report.
 */
const supportInWords = (t: AnalyticsTotals) =>
  `${t.tickets + (t.chats_answered ?? 0)} requests in all: ${t.chats_answered ?? 0} questions answered in the chat without a ticket, ` +
  `and ${t.tickets} tickets. Of the tickets, ${t.tickets_ai} were handled by the AI alone and ${t.tickets_escalated} were handed to a person ` +
  `(separate groups: tickets_escalated is not a share of tickets_ai); ${t.tickets_solved} solved, ${t.tickets_open} not solved yet. ` +
  `AI handled ${t.ai_rate}% of all requests on its own.`;

export function analysisTools(api: DemoAPI) {
  const getMetrics = createTool({
    name: "get_metrics",
    description:
      "Live totals and the chart datasets for this analysis: support tickets, orders and revenue, the CRM pipeline and the marketing " +
      "campaigns (a sales analysis gets only the sales charts). Money is in ₹. Call this before writing anything.",
    parameters: z.object({}),
    execute: async (_args, opts) => {
      const { scope } = runOf<AnalysisRun>(opts);
      const ids = allowed(scope);
      const m = await api.metrics();
      return {
        generated_at: m.generated_at,
        totals: m.totals,
        ...(scope === "all" && { support_in_words: supportInWords(m.totals) }),
        datasets: m.datasets.filter((d) => ids.includes(d.id)).map(({ id, description, series, rows }) => ({ id, description, series, rows })),
      };
    },
  });

  const getPreviousReports = createTool({
    name: "get_previous_reports",
    description: "The last few published reports of this analysis's scope, with the totals they were written against, to spot what changed since.",
    parameters: z.object({}),
    execute: async (_args, opts) => ({
      reports: (await api.reports(runOf<AnalysisRun>(opts).scope)).reports.slice(0, 3).map((r) => ({ created_at: r.created_at, headline: r.headline, totals: r.snapshot })),
    }),
  });

  const publishReport = createTool({
    name: "publish_report",
    description: "Publish the report on the Control Room's Analytics page. Call exactly once, at the end.",
    parameters: z.object({
      headline: z.string().min(1).max(200).describe("One sentence: the single most important thing, with its number"),
      insights: z
        .array(
          z.object({
            dataset: z.enum(DATASET_IDS).describe("The chart this finding is about"),
            title: z.string().min(1).max(80).describe("Short, with the key number, e.g. 'Meta Ads: 3 leads for ₹38,400'"),
            finding: z.string().min(1).max(400).describe("1–2 sentences: what the numbers show and one concrete next action"),
            tone: z.enum(["good", "watch", "risk"]),
          }),
        )
        .min(3)
        .max(6),
    }),
    execute: async ({ headline, insights }, opts) => {
      const run = runOf<AnalysisRun>(opts);
      if (run.report) return { ok: false, error: `Report #${run.report.id} is already published for this run.` };
      const ids = allowed(run.scope);
      const outside = insights.filter((i) => !ids.includes(i.dataset)).map((i) => i.dataset);
      if (outside.length) return { ok: false, error: `This is a ${run.scope} analysis: findings may only be about ${ids.join(", ")}. Not: ${outside.join(", ")}.` };
      run.report = await api.saveReport({
        scope: run.scope,
        headline: indianRupees(headline),
        insights: insights.map((i) => ({ ...i, title: indianRupees(i.title), finding: indianRupees(i.finding) })),
      });
      return { ok: true, report_id: run.report.id };
    },
  });

  return [getMetrics, getPreviousReports, publishReport];
}
