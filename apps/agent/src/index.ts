/**
 * ResolveAI agent service, built on VoltAgent.
 *
 * The demo API (apps/api) forwards ShopKart chats to POST /intake, and POST /lead, /analysis and
 * /campaigns/sync here, when AGENT_URL is set. Agents:
 * Agents:
 * - main: triages every request (new or status check, intent, signals, plan); code sets the level
 * - low / medium / high: work the ticket with the tools their level allows; critical goes to a person
 * - sales: business enquiries (score, move the deal, book an intro call)
 * - analysis: reads live metrics and publishes findings for the Control Room's Analytics charts
 * - leads: turns marketing campaign responses into scored CRM leads, skipping spam and duplicates
 *
 * Routes:
 * - POST /intake: a channel's request. Needs `Authorization: Bearer <channel token>` (Control Room → Channels)
 * - POST /approvals/:id/decided: the demo API calls this after a person approves or rejects in the Control Room
 * - POST /lead: business enquiries; POST /analysis; POST /campaigns/sync
 * - GET /health
 *
 * The agents reach Zendesk, ShopKart + Paytm and HubSpot through the base URLs and tokens set on the
 * Control Room's Connectors page. With DATABASE_URL set, conversation memory (voltagent_* tables) and
 * the chat → ticket map (agent_chat_sessions) live in Postgres. Runs, steps, approvals and resolved
 * cases are kept by the demo API in its rai_* tables.
 *
 * Models come in two tiers (see ./models.ts): heavy (main, level agents, analysis) defaults to anthropic/claude-sonnet-5,
 * lite (sales, leads) to openai/gpt-5.6-luna on Azure OpenAI. Override with AGENT_MODEL_HEAVY / AGENT_MODEL_LITE.
 */
import { VoltAgent } from "@voltagent/core";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { createLevelAgents } from "./agents/levels.ts";
import { createMainAgent, createWriterAgent } from "./agents/main.ts";
import { createAnalysisAgent } from "./agents/analysis.ts";
import { createLeadsAgent } from "./agents/leads.ts";
import { createSalesAgent } from "./agents/sales.ts";
import { createDemoAPI } from "./demo-api.ts";
import { createPlatform } from "./platform.ts";
import { createAgentMemory } from "./memory.ts";
import { hasKey, keyVar, MODELS } from "./models.ts";
import { createService } from "./service.ts";
import { memorySessions, postgresSessions } from "./sessions.ts";

const PORT = Number(process.env.AGENT_PORT ?? 8000);
const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const INTERNAL_KEY = process.env.RESOLVEAI_INTERNAL_KEY || "";

const DATABASE_URL = process.env.DATABASE_URL;

// See ./memory.ts: shared conversation memory, the analysis agent's working memory, retention.
const { memory, analysisMemory, prune } = createAgentMemory(DATABASE_URL);
const RETENTION_DAYS = Number(process.env.AGENT_MEMORY_RETENTION_DAYS ?? 30);
const sessions = DATABASE_URL ? await postgresSessions(DATABASE_URL) : memorySessions();

const platform = createPlatform(API_URL, fetch, INTERNAL_KEY);
const api = createDemoAPI(API_URL, fetch, () => platform.connectors());
// Heavy: triage and money/policy decisions with customers, and reasoning across every dataset.
// Lite: short status messages and rule-based triage of sales enquiries and campaign responses.
const main = createMainAgent(MODELS.heavy, memory);
const writer = createWriterAgent(MODELS.heavy); // every customer-facing reply gets the strong model
const levels = createLevelAgents(api, MODELS.heavy, platform, memory);
const analysis = createAnalysisAgent(api, MODELS.heavy, analysisMemory);
const sales = createSalesAgent(api, MODELS.lite, memory);
const leads = createLeadsAgent(api, MODELS.lite, memory);
const service = createService({ api, platform, main, writer, levels, sales, analysis, leads, sessions, analysisMemory });

const bearer = (header: string | undefined) => header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

new VoltAgent({
  agents: { main, writer, direct: levels.direct, low: levels.low, medium: levels.medium, high: levels.high, sales, analysis, leads },
  logger: createPinoLogger({ name: "resolveai-agent", level: "info" }),
  checkDependencies: false,
  server: honoServer({
    port: PORT,
    configureApp: (app) => {
      app.get("/health", (c) =>
        c.json({
          status: "ok",
          models: { heavy: { model: MODELS.heavy, key: hasKey(MODELS.heavy), agents: ["main", "writer", "low-direct", "low", "medium", "high", "analysis"] }, lite: { model: MODELS.lite, key: hasKey(MODELS.lite), agents: ["sales", "leads"] } },
          api: API_URL,
          storage: DATABASE_URL ? "postgres" : "memory",
          memory_retention_days: DATABASE_URL && RETENTION_DAYS > 0 ? RETENTION_DAYS : null,
        }),
      );
            app.post("/intake", async (c) => {
        const { status, body } = await service.intake(bearer(c.req.header("authorization")), await c.req.json().catch(() => null));
        return c.json(body, status as 200);
      });
      app.post("/approvals/:id/decided", async (c) => {
        if (INTERNAL_KEY && c.req.header("x-resolveai-key") !== INTERNAL_KEY) return c.json({ error: "Not allowed" }, 401);
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id)) return c.json({ error: "Approval id must be a number" }, 400);
        const { status, body } = await service.approvalDecided(id);
        return c.json(body, status as 200);
      });
      app.post("/lead", async (c) => {
        const { status, body } = await service.lead(await c.req.json().catch(() => null));
        return c.json(body, status as 201);
      });
      app.post("/analysis", async (c) => {
        const { status, body } = await service.analyze(await c.req.json().catch(() => ({})));
        return c.json(body, status as 201);
      });
      app.post("/campaigns/sync", async (c) => {
        const { status, body } = await service.syncLeads(await c.req.json().catch(() => ({})));
        return c.json(body, status as 200);
      });
    },
  }),
});

console.log(`ResolveAI agent: heavy ${MODELS.heavy} (main, writer, level agents, analysis), lite ${MODELS.lite} (sales, leads), demo API ${API_URL}, memory ${DATABASE_URL ? `Postgres at ${new URL(DATABASE_URL).host}` : "in process"}`);
console.log("  Channels send requests to POST /intake with their token (Control Room → Channels).");
if (!DATABASE_URL) console.warn("  DATABASE_URL is not set: chat memory and sessions are lost when the agent restarts.");

// Forget threads nobody has touched for RETENTION_DAYS: now, then every 6 hours.
async function pruneMemory() {
  try {
    const n = await prune(RETENTION_DAYS);
    if (n) console.log(`[agent] memory retention: removed ${n} conversations idle for over ${RETENTION_DAYS} days`);
  } catch (e) {
    console.warn("[agent] memory retention failed:", (e as Error).message);
  }
}
if (DATABASE_URL && RETENTION_DAYS > 0) {
  void pruneMemory();
  setInterval(pruneMemory, 6 * 3_600_000).unref();
}
for (const model of new Set(Object.values(MODELS))) {
  if (!hasKey(model)) console.warn(`  ${keyVar(model)} is not set for ${model}: add it to the repo-root .env, or those agents hand everything to a person.`);
}
