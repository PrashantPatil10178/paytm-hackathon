import { resetDemoData } from "@ph/db";
import { agentMode, agentRoutes } from "./agent.ts";
import { analyticsRoutes } from "./analytics.ts";
import { campaignRoutes } from "./campaigns.ts";
import { crmRoutes } from "./crm.ts";
import { formRoutes } from "./forms.ts";
import { db, prepare } from "./db.ts";
import { CORS, handle, ok } from "./http.ts";
import { shopRoutes } from "./shop.ts";
import { voiceMode, voiceRoutes } from "./voice.ts";
import { zendeskRoutes } from "./zendesk.ts";

const state = await prepare();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  // Agent calls take longer than Bun's 10 s default (a phone turn up to 25 s, an analysis up to 2 min): 255 s is Bun's max.
  idleTimeout: 255,
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
    ...campaignRoutes,
    ...analyticsRoutes,
    ...agentRoutes,
    ...voiceRoutes,
    ...formRoutes,
  },
  fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return ok({ error: `No route for ${req.method} ${new URL(req.url).pathname}` }, 404);
  },
});

console.log(`Demo API ready on ${server.url}`);
console.log(`  data: Postgres at ${new URL(process.env.DATABASE_URL!).host} (${state === "seeded" ? "empty, seeded the demo data" : "existing data kept; bun run reset re-seeds"})`);
console.log(`  /chat, /lead, /analysis, /campaigns/sync: ${agentMode}`);
console.log(`  /voice (Sarvam phone line): ${voiceMode}`);
