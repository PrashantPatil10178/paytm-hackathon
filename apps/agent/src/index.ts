/**
 * ResolveAI agent service, built on VoltAgent.
 *
 * The demo API (apps/api) forwards POST /chat and POST /lead here when AGENT_URL is set. Two agents
 * do the work through the demo API's Zendesk / CRM / shop endpoints:
 * - support: ShopKart chats (refunds, order tracking, payment escalations)
 * - sales: business enquiries (score, move the deal, book an intro call)
 *
 * The model comes from AGENT_MODEL, else COPILOT_MODEL ("provider/model", read from the repo-root .env),
 * else anthropic/claude-opus-5-5. Keys: ANTHROPIC_API_KEY, or OPENAI_API_KEY + OPENAI_BASE_URL for Azure OpenAI.
 */
import { VoltAgent } from "@voltagent/core";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { createSalesAgent } from "./agents/sales.ts";
import { createSupportAgent } from "./agents/support.ts";
import { createDemoAPI } from "./demo-api.ts";
import { createService } from "./service.ts";

const PORT = Number(process.env.AGENT_PORT ?? 8000);
const API_URL = (process.env.API_URL || "http://localhost:4000").replace(/\/$/, "");
const MODEL = process.env.AGENT_MODEL || process.env.COPILOT_MODEL || "anthropic/claude-opus-5-5";
const PROVIDER = MODEL.split(/[:/]/)[0]!.toLowerCase();
const KEY_VAR = PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";

const api = createDemoAPI(API_URL);
const support = createSupportAgent(api, MODEL);
const sales = createSalesAgent(api, MODEL);
const service = createService({ api, support, sales });

new VoltAgent({
  agents: { support, sales },
  logger: createPinoLogger({ name: "resolveai-agent", level: "info" }),
  checkDependencies: false,
  server: honoServer({
    port: PORT,
    configureApp: (app) => {
      app.get("/health", (c) => c.json({ status: "ok", model: MODEL, api: API_URL, key: Boolean(process.env[KEY_VAR]) }));
      app.post("/chat", async (c) => {
        const { status, body } = await service.chat(await c.req.json().catch(() => null));
        return c.json(body, status as 200);
      });
      app.post("/lead", async (c) => {
        const { status, body } = await service.lead(await c.req.json().catch(() => null));
        return c.json(body, status as 201);
      });
    },
  }),
});

console.log(`ResolveAI agent: model ${MODEL}, demo API ${API_URL}`);
if (!process.env[KEY_VAR]) console.warn(`  ${KEY_VAR} is not set: add it to the repo-root .env, or every chat goes to a person.`);
