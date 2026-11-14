import { agentMode, agentRoutes } from "./agent.ts";
import { crmRoutes } from "./crm.ts";
import { reset } from "./db.ts";
import { CORS, handle, ok } from "./http.ts";
import { shopRoutes } from "./shop.ts";
import { zendeskRoutes } from "./zendesk.ts";

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  routes: {
    "/health": () => ok({ ok: true }),
    "/admin/reset": {
      POST: handle(() => {
        reset();
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
console.log(`  /chat and /lead: ${agentMode}`);
