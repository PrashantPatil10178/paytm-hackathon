import { resetDemoData } from "@ph/db";
import { agentMode, agentRoutes } from "./agent.ts";
import { crmRoutes } from "./crm.ts";
import { prepareShopkartToken, resolveaiRoutes } from "./resolveai.ts";
import { db, prepare } from "./db.ts";
import { CORS, handle, ok } from "./http.ts";
import { shopRoutes } from "./shop.ts";
import { zendeskRoutes } from "./zendesk.ts";

const state = await prepare();
const tokenSource = await prepareShopkartToken();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  // Chats wait on the agent (a model call or two); Bun's default 10 s idle timeout would cut them off.
  idleTimeout: 120,
  routes: {
    "/health": () => ok({ ok: true }),
    "/admin/reset": {
      POST: handle(async () => {
        await resetDemoData(db);
        return ok({ ok: true, message: "Demo data reset" });
      }),
    },
    ...zendeskRoutes,
    ...crmRoutes,
    ...shopRoutes,
    ...agentRoutes,
    ...resolveaiRoutes,
  },
  fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return ok({ error: `No route for ${req.method} ${new URL(req.url).pathname}` }, 404);
  },
});

console.log(`Demo API ready on ${server.url}`);
console.log(`  data: Postgres at ${new URL(process.env.DATABASE_URL!).host} (${state === "seeded" ? "empty, seeded the demo data" : "existing data kept; bun run reset re-seeds"})`);
console.log(`  /chat and /lead: ${agentMode}`);
console.log(
  tokenSource === "env"
    ? "  ShopKart channel token: from SHOPKART_CHANNEL_TOKEN"
    : "  ShopKart channel token: issued a fresh one for this run (set SHOPKART_CHANNEL_TOKEN in .env to pin it)",
);
