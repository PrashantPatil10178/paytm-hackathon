/**
 * ResolveAI agent service, built on VoltAgent.
 *
 * Agents:
 * - main: triages every request (new or status check, intent, signals, plan); code sets the level
 * - low / medium / high: work the ticket with the tools their level allows; critical goes to a person
 * - sales: business enquiries (score, move the deal, book an intro call)
 *
 * Routes:
 * - POST /intake: a channel's request. Needs `Authorization: Bearer <channel token>` (Control Room → Channels)
 * - POST /approvals/:id/decided: the demo API calls this after a person approves or rejects in the Control Room
 * - POST /lead: business enquiries
 * - GET /health
 *
 * The agents reach Zendesk, ShopKart + Paytm and HubSpot through the base URLs and tokens set on the
 * Control Room's Connectors page. With DATABASE_URL set, conversation memory (voltagent_* tables) and
 * the chat → ticket map (agent_chat_sessions) live in Postgres. Runs, steps, approvals and resolved
 * cases are kept by the demo API in its rai_* tables.
 *
 * The model comes from AGENT_MODEL, else COPILOT_MODEL ("provider/model", read from the repo-root .env),
 * else anthropic/claude-opus-5-5. Keys: ANTHROPIC_API_KEY, or OPENAI_API_KEY + OPENAI_BASE_URL for Azure OpenAI.
 */
import { Memory, VoltAgent } from "@voltagent/core";
import { createPinoLogger } from "@voltagent/logger";
import { PostgreSQLMemoryAdapter } from "@voltagent/postgres";
import { honoServer } from "@voltagent/server-hono";
import { createLevelAgents } from "./agents/levels.ts";
import { createMainAgent, createWriterAgent } from "./agents/main.ts";
import { createSalesAgent } from "./agents/sales.ts";
import { createDemoAPI } from "./demo-api.ts";
import { createPlatform } from "./platform.ts";
import { createService } from "./service.ts";
import { memorySessions, postgresSessions } from "./sessions.ts";

const PORT = Number(process.env.AGENT_PORT ?? 8000);
const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const MODEL = process.env.AGENT_MODEL || process.env.COPILOT_MODEL || "anthropic/claude-opus-5-5";
const PROVIDER = MODEL.split(/[:/]/)[0]!.toLowerCase();
const KEY_VAR = PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
const INTERNAL_KEY = process.env.RESOLVEAI_INTERNAL_KEY || "";

const DATABASE_URL = process.env.DATABASE_URL;

const memory = DATABASE_URL
  ? new Memory({ storage: new PostgreSQLMemoryAdapter({ connection: DATABASE_URL, tablePrefix: "voltagent", maxConnections: 5 }) })
  : undefined;
const sessions = DATABASE_URL ? await postgresSessions(DATABASE_URL) : memorySessions();

const platform = createPlatform(API_URL, fetch, INTERNAL_KEY);
const api = createDemoAPI(API_URL, fetch, () => platform.connectors());
const main = createMainAgent(MODEL, memory);
const writer = createWriterAgent(MODEL);
const levels = createLevelAgents(api, MODEL, platform, memory);
const sales = createSalesAgent(api, MODEL, memory);
const service = createService({ api, platform, main, writer, levels, sales, sessions });

const bearer = (header: string | undefined) => header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

new VoltAgent({
  agents: { main, writer, low: levels.low, medium: levels.medium, high: levels.high, sales },
  logger: createPinoLogger({ name: "resolveai-agent", level: "info" }),
  checkDependencies: false,
  server: honoServer({
    port: PORT,
    configureApp: (app) => {
      app.get("/health", (c) => c.json({ status: "ok", model: MODEL, api: API_URL, key: Boolean(process.env[KEY_VAR]), storage: DATABASE_URL ? "postgres" : "memory" }));
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
    },
  }),
});

console.log(`ResolveAI agent: model ${MODEL}, demo API ${API_URL}, memory ${DATABASE_URL ? `Postgres at ${new URL(DATABASE_URL).host}` : "in process"}`);
console.log("  Channels send requests to POST /intake with their token (Control Room → Channels).");
if (!DATABASE_URL) console.warn("  DATABASE_URL is not set: chat memory and sessions are lost when the agent restarts.");
if (!process.env[KEY_VAR]) console.warn(`  ${KEY_VAR} is not set: add it to the repo-root .env, or every chat goes to a person.`);
