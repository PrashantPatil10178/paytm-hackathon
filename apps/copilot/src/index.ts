/**
 * CopilotKit runtime for the Control Room's "Ask Aria" panel.
 *
 * The dashboard talks AG-UI to this server; the BuiltInAgent calls the model. The agent has no
 * server-side tools: everything it shows comes from the dashboard itself, which registers its
 * generative-UI components as frontend tools (useComponent) and shares its live data as context
 * (useAgentContext). So the model picks a card and an id; the card reads the real record.
 *
 * The model comes from COPILOT_MODEL ("provider/model"), read from the repo-root .env:
 * - anthropic/claude-opus-5-5 (default) needs ANTHROPIC_API_KEY (ANTHROPIC_BASE_URL for Claude on Azure Foundry).
 * - openai/<deployment> with OPENAI_BASE_URL=https://<resource>.services.ai.azure.com/openai/v1 and
 *   OPENAI_API_KEY runs on Azure OpenAI (Responses API). This is the current local setup.
 */
import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

const PORT = Number(process.env.COPILOT_PORT ?? 4100);
const MODEL = process.env.COPILOT_MODEL || "anthropic/claude-opus-5-5";
const PROVIDER = MODEL.split(/[:/]/)[0]!.toLowerCase();
const KEY_VAR = PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
const HOST = PROVIDER === "openai" ? process.env.OPENAI_BASE_URL : process.env.ANTHROPIC_BASE_URL;

const PROMPT = `You are Aria's control-room copilot inside ResolveAI, talking to the support lead at ShopKart.
Aria is the AI teammate that resolves support tickets and sales leads in the company's own tools
(Zendesk, Freshdesk, HubSpot, Paytm, Shiprocket). The lead uses you to understand what Aria did and
what needs a human.

How to answer
- The dashboard shares its live data with you as context: tickets, leads, pending approvals,
  14-day stats, and live sales data (CRM deals, campaigns, sales totals). Answer only from that data. If something is not in it, say so. Never invent ids,
  names, amounts or numbers.
- Prefer showing over telling. When the question is about specific records or metrics, call the
  matching show_* tool so the dashboard draws a live card.
- After a card, write one or two short sentences that add what the card does not say: which item
  matters most and why, or what to do next. Never list the card's rows again, and no bullet lists
  or headings after a card.
  - show_ticket: one ticket by id (e.g. RA-1047), with its tool chain and outcome.
  - show_tickets: a filtered list of tickets (status, level, channel, solvedBy).
  - show_approvals: actions waiting for a human decision. The lead can approve or reject in the card.
  - show_metrics: the 14-day KPIs and the AI vs human volume chart.
  - show_lead: one sales lead by id (e.g. L-311) from the Leads page.

Sales (live from the CRM and campaigns in Postgres; the context has crmDeals, campaigns, salesTotals and
latestSalesReport)
  - show_deals: open CRM deals, or one stage, or one score (hot, warm, cold). One card per question:
    "hot deals" is score "hot" with no stage, not one call per stage.
  - show_deal: one CRM deal by number (e.g. 13), with its contact, next step, booked call and activity.
  - show_campaigns: every campaign with spend, responses, leads and cost per lead.
  - show_campaign_responses: replies waiting for Aria (new), turned into leads (converted) or skipped.
  - show_sales_analytics: sales KPIs, one sales chart and the latest sales report headline.
  - fetch_campaign_leads: runs the leads agent, which creates real CRM leads. Only when the lead asks to fetch,
    process or import leads. Afterwards say how many leads, which are hot, and anything that failed.
  - run_sales_analysis: runs a fresh sales analysis (about half a minute). Only when the lead wants new insights
    or advice; for a number that is already in the context, answer or use a show_* card instead.
- Use open_page only when the lead asks to go somewhere (pages include analytics, campaigns, sales_analytics).
- Money is in Indian rupees (write ₹4,250). Times are IST. Keep replies short and plain.`;

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: MODEL,
      prompt: PROMPT,
      maxSteps: 6,
      maxOutputTokens: 4096,
    }),
  },
});

const copilotkit = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", cors: true });

const server = Bun.serve({
  port: PORT,
  // Agent runs stream for as long as the model talks; Bun's 10 s default would cut them off.
  idleTimeout: 0,
  routes: {
    "/health": () => Response.json({ ok: true, model: MODEL, host: HOST ? new URL(HOST).host : "default", key: Boolean(process.env[KEY_VAR]) }),
  },
  fetch: copilotkit,
});

console.log(`CopilotKit runtime ready on ${server.url}api/copilotkit (model ${MODEL}${HOST ? ` via ${new URL(HOST).host}` : ""})`);
if (!process.env[KEY_VAR]) {
  console.warn(`  ${KEY_VAR} is not set: add it to the repo-root .env, or Aria can't answer.`);
}
