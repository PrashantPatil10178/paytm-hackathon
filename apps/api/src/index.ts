import { resetDemoData } from "@ph/db";
import { agentMode, agentRoutes } from "./agent.ts";
import { crmRoutes } from "./crm.ts";
import { db, prepare } from "./db.ts";
import { CORS, handle, ok } from "./http.ts";
import { shopRoutes } from "./shop.ts";
import { zendeskRoutes } from "./zendesk.ts";

const state = await prepare();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
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
  },
  fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return ok({ error: `No route for ${req.method} ${new URL(req.url).pathname}` }, 404);
  },
});

console.log(`Demo API ready on ${server.url}`);
console.log(`  data: Postgres at ${new URL(process.env.DATABASE_URL!).host} (${state === "seeded" ? "empty, seeded the demo data" : "existing data kept; bun run reset re-seeds"})`);
console.log(`  /chat and /lead: ${agentMode}`);
