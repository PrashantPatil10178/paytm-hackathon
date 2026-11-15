/**
 * ResolveAI agent service, built on VoltAgent.
 *
 * The demo API (apps/api) forwards POST /chat, /lead, /analysis and /campaigns/sync here when AGENT_URL
 * is set. Four agents do the work through the demo API's endpoints:
 * - support: ShopKart chats (refunds, order tracking, payment escalations)
 * - sales: business enquiries (score, move the deal, book an intro call)
 * - analysis: reads live metrics and publishes findings for the Control Room's Analytics charts
 * - leads: turns marketing campaign responses into scored CRM leads, skipping spam and duplicates
 *
 * With DATABASE_URL set, every agent's conversation memory (VoltAgent's voltagent_* tables) and the
 * chat → ticket map (agent_chat_sessions) live in Postgres, so they survive restarts.
 *
 * Models come in two tiers (see ./models.ts): heavy (support, analysis) defaults to anthropic/claude-sonnet-5,
 * lite (sales, leads) to openai/gpt-5.6-luna on Azure OpenAI. Override with AGENT_MODEL_HEAVY / AGENT_MODEL_LITE.
 */
import { Memory, VoltAgent } from "@voltagent/core";
import { createPinoLogger } from "@voltagent/logger";
import { PostgreSQLMemoryAdapter } from "@voltagent/postgres";
import { honoServer } from "@voltagent/server-hono";
import { createAnalysisAgent } from "./agents/analysis.ts";
import { createLeadsAgent } from "./agents/leads.ts";
import { createSalesAgent } from "./agents/sales.ts";
import { createSupportAgent } from "./agents/support.ts";
import { createDemoAPI } from "./demo-api.ts";
import { hasKey, keyVar, MODELS } from "./models.ts";
import { createService } from "./service.ts";
import { memorySessions, postgresSessions } from "./sessions.ts";

const PORT = Number(process.env.AGENT_PORT ?? 8000);
const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");

const DATABASE_URL = process.env.DATABASE_URL;

const memory = DATABASE_URL
  ? new Memory({ storage: new PostgreSQLMemoryAdapter({ connection: DATABASE_URL, tablePrefix: "voltagent", maxConnections: 5 }) })
  : undefined;
const sessions = DATABASE_URL ? await postgresSessions(DATABASE_URL) : memorySessions();

const api = createDemoAPI(API_URL);
// Heavy: money/policy decisions with customers, and reasoning across every dataset. Lite: rule-based triage.
const support = createSupportAgent(api, MODELS.heavy, memory);
const analysis = createAnalysisAgent(api, MODELS.heavy, memory);
const sales = createSalesAgent(api, MODELS.lite, memory);
const leads = createLeadsAgent(api, MODELS.lite, memory);
const service = createService({ api, support, sales, analysis, leads, sessions });

new VoltAgent({
  agents: { support, sales, analysis, leads },
  logger: createPinoLogger({ name: "resolveai-agent", level: "info" }),
  checkDependencies: false,
  server: honoServer({
    port: PORT,
    configureApp: (app) => {
      app.get("/health", (c) =>
        c.json({
          status: "ok",
          models: { heavy: { model: MODELS.heavy, key: hasKey(MODELS.heavy), agents: ["support", "analysis"] }, lite: { model: MODELS.lite, key: hasKey(MODELS.lite), agents: ["sales", "leads"] } },
          api: API_URL,
          storage: DATABASE_URL ? "postgres" : "memory",
        }),
      );
      app.post("/chat", async (c) => {
        const { status, body } = await service.chat(await c.req.json().catch(() => null));
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

console.log(`ResolveAI agent: heavy ${MODELS.heavy} (support, analysis), lite ${MODELS.lite} (sales, leads), demo API ${API_URL}, memory ${DATABASE_URL ? `Postgres at ${new URL(DATABASE_URL).host}` : "in process"}`);
if (!DATABASE_URL) console.warn("  DATABASE_URL is not set: chat memory and sessions are lost when the agent restarts.");
for (const model of new Set(Object.values(MODELS))) {
  if (!hasKey(model)) console.warn(`  ${keyVar(model)} is not set for ${model}: add it to the repo-root .env, or those agents hand everything to a person.`);
}
