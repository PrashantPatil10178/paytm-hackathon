import { resetDemoData } from "@ph/db";
import { agentMode, agentRoutes } from "./agent.ts";
import { analyticsRoutes } from "./analytics.ts";
import { attachmentRoutes } from "./attachments.ts";
import { callRoutes } from "./calls.ts";
import { campaignRoutes } from "./campaigns.ts";
import { chatRoutes } from "./chats.ts";
import { controlRoomRoutes } from "./controlroom.ts";
import { crmRoutes } from "./crm.ts";
import { formRoutes } from "./forms.ts";
import { policyRoutes } from "./policies.ts";
import { prepareShopkartToken, resolveaiRoutes, sweepStuckRuns } from "./resolveai.ts";
import { db, prepare } from "./db.ts";
import { CORS, handle, ok } from "./http.ts";
import { shopRoutes } from "./shop.ts";
import { voiceMode, voiceRoutes } from "./voice.ts";
import { zendeskRoutes } from "./zendesk.ts";

const state = await prepare();
const tokenSource = await prepareShopkartToken();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4000),
  // Agent calls take longer than Bun's 10 s default (a chat a model call or two, a phone turn up to 25 s, an
  // analysis up to 2 min): 255 s is Bun's max.
  idleTimeout: 255,
  routes: {
    "/health": () => ok({ ok: true }),
    "/admin/reset": {
      POST: handle(async () => {
        await resetDemoData(db);
        return ok({ ok: true, message: "Demo data reset" });
      }),
    },
    ...attachmentRoutes,
    ...zendeskRoutes,
    ...crmRoutes,
    ...shopRoutes,
    ...campaignRoutes,
    ...analyticsRoutes,
    ...agentRoutes,
    ...chatRoutes,
    ...resolveaiRoutes,
    ...policyRoutes,
    ...callRoutes,
    ...controlRoomRoutes,
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
console.log(
  tokenSource === "env"
    ? "  ShopKart channel token: from SHOPKART_CHANNEL_TOKEN"
    : "  ShopKart channel token: issued a fresh one for this run (set SHOPKART_CHANNEL_TOKEN in .env to pin it)",
);
console.log(`  /chat, /lead, /analysis, /campaigns/sync: ${agentMode}`);
console.log(`  /voice (Sarvam phone line): ${voiceMode}`);

// Runs cut off mid-way (a restart, a dropped connection) are marked failed after 5 minutes without progress.
async function sweep() {
  try {
    const n = await sweepStuckRuns();
    if (n) console.log(`  marked ${n} stuck run${n === 1 ? "" : "s"} as failed (no progress for 5 minutes)`);
  } catch (e) {
    console.warn("[runs] stuck-run sweep failed:", (e as Error).message);
  }
}
void sweep();
setInterval(sweep, 60_000).unref();
