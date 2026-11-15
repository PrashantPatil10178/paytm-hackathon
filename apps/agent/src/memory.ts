/**
 * How the agents remember (all in Postgres with DATABASE_URL, in process without it):
 *
 * - `memory`: conversation history shared by every agent (VoltAgent's voltagent_* tables). Before each run the
 *   agent loads the last few messages of its thread; threads are keyed per chat (support) or per person (sales,
 *   leads; see `personKey`).
 * - `analysisMemory`: the same storage plus working memory: a short note the service rewrites after every
 *   published report (`analysisNote`). The analysis agent reads that note from its system prompt instead of raw
 *   history (runs use contextLimit 0), so "what changed since last time" costs a few hundred tokens, not a
 *   replay of the last run's tool output.
 * - Cleanup: `bun run reset` wipes these tables with the demo data (packages/db). `prune` deletes threads idle
 *   longer than AGENT_MEMORY_RETENTION_DAYS (default 30, 0 turns it off); messages and steps go with them.
 */
import { rupees, type AnalysisReport } from "@ph/shared";
import { InMemoryStorageAdapter, Memory } from "@voltagent/core";
import { PostgreSQLMemoryAdapter } from "@voltagent/postgres";
import { SQL } from "bun";

/** The analysis agent's single long-running thread. */
export const ANALYSIS_THREAD = { userId: "control-room", conversationId: "control-room-analysis" } as const;

/** One thread per person across enquiries and campaign replies, keyed by their email. */
export const personKey = (email: string) => email.trim().toLowerCase();

export interface AgentMemory {
  memory: Memory;
  analysisMemory: Memory;
  /** Deletes threads idle for more than `days`. Returns how many conversations were removed. */
  prune(days: number): Promise<number>;
  close(): Promise<void>;
}

export function createAgentMemory(url = process.env.DATABASE_URL): AgentMemory {
  const storage = url ? new PostgreSQLMemoryAdapter({ connection: url, tablePrefix: "voltagent", maxConnections: 5 }) : new InMemoryStorageAdapter();
  const sql = url ? new SQL(url, { max: 2, idleTimeout: 30, connectionTimeout: 10 }) : null;
  return {
    memory: new Memory({ storage }),
    analysisMemory: new Memory({ storage, workingMemory: { enabled: true, scope: "conversation" } }),
    async prune(days) {
      if (!sql || !(days > 0)) return 0;
      const cutoff = new Date(Date.now() - days * 86_400_000);
      const gone = await sql`delete from voltagent_conversations where updated_at < ${cutoff} returning id`;
      await sql`delete from agent_chat_sessions where updated_at < ${cutoff}`.catch(() => {}); // table may not exist yet
      return gone.length;
    },
    close: async () => void (await sql?.close()),
  };
}

/** The working-memory note for the analysis thread, rewritten after each report. Small on purpose. */
export function analysisNote(report: AnalysisReport, previous: string | null): string {
  const t = report.snapshot;
  const when = new Date(report.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const earlier = previous?.match(/^## Last report[^\n]*\n[^\n]*/m)?.[0].replace("## Last report", "## Report before that");
  return [
    `## Last report (${when} IST)`,
    `Headline: ${report.headline}`,
    ...report.insights.map((i) => `- [${i.tone}] ${i.title} (${i.dataset})`),
    `Totals then: AI handled ${t.ai_rate}% of ${t.tickets} tickets (${t.tickets_open} open, ${t.tickets_escalated} escalated); ` +
      `revenue 14d ${rupees(t.revenue_14d)}; open pipeline ${rupees(t.pipeline_open)} in ${t.deals_open} deals (${t.hot_open} hot); ` +
      `campaigns ${rupees(t.campaign_spend)} spent, ${t.campaign_responses} responses, ${t.campaign_leads} leads.`,
    ...(earlier ? ["", earlier] : []),
  ].join("\n");
}
