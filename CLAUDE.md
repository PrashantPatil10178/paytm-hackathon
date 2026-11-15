# ResolveAI · Paytm hackathon monorepo

ResolveAI is an AI teammate ("Aria") that resolves customer-support tickets and sales leads inside a
company's own tools. This repo is the demo stage: look-alike Zendesk, HubSpot and shop apps, a shared
mock API they all read and write, the ResolveAI Control Room dashboard, and the agent service.
Judges watch the agent's work appear live, so the screens matter as much as the logic.

## Layout

| Path | What | Port | Stack |
| --- | --- | --- | --- |
| `apps/api` | Mock API (Zendesk, CRM, shop) + rule-based agent stand-in. Data in Postgres. | 4000 | Bun.serve, Drizzle |
| `apps/zendesk` | Zendesk look-alike: views, tickets, replies, internal notes | 3001 | Bun HTML bundler, React 19, Tailwind v4 |
| `apps/hubspot` | HubSpot CRM look-alike: deals pipeline (drag and drop), contacts | 3002 | same |
| `apps/shopkart` | Customer side: shop, My Orders, support chat, business enquiry | 3003 | same |
| `apps/dashboard` | ResolveAI Control Room: areas Home, Support, Sales, Connect, Aria (KPIs, analytics, tickets, leads, campaigns, approvals, board, connectors, audit, settings) | 3004 | Vite 8, React 19 (TS + some JSX), Tailwind v4, Recharts |
| `apps/agent` | The ResolveAI agents (support, sales, analysis, leads): `/chat`, `/lead`, `/analysis`, `/campaigns/sync` | 8000 | Bun, VoltAgent (`@voltagent/core`, `server-hono`) |
| `apps/copilot` | CopilotKit runtime behind the dashboard's "Ask Aria" chat (`/api/copilotkit`) | 4100 | Bun, `@copilotkit/runtime/v2` |
| `packages/db` | Postgres: Drizzle schema, SQL migrations, seed data, row → API type mappers | – | Drizzle ORM on `Bun.SQL` |
| `packages/shared` | API types, ₹/date formatting, polling hooks, app server helper, **brand (logo)** | – | TS |

## Commands (run from the repo root)

```sh
bun install
bun run dev              # everything; API uses its built-in stand-in agent
bun run dev:agent        # everything, with the API forwarding /chat and /lead to apps/agent on :8000
bun run dev:zendesk      # API + one app (also dev:hubspot, dev:shop, dev:api)
bun run dev:dashboard    # API + dashboard + the Ask Aria runtime (apps/copilot); Analytics and Campaigns read the live API
bun run reset            # wipe and re-seed the demo data in Postgres. Do this before every demo run.
bun run db:generate      # new SQL migration after editing packages/db/src/schema.ts (commit it)
bun run db:migrate       # apply migrations + seed an empty DB (the API does this on startup too)
bun run check-types      # tsc for the TS apps, the dashboard's .ts/.tsx and packages/shared
bun run lint             # oxlint (dashboard)
bun run test:agent       # bun test for apps/agent (no other services or API keys needed)
bun run build
```

Long-running servers: start them in a visible VS Code terminal with `vsterm` (see the user's global
instructions), not as hidden background jobs.

## How the pieces talk

- Every demo screen polls the API every 2 s (`packages/shared/src/react.ts`), so changes appear without refresh.
- Demo apps proxy `/api/*` to `API_URL` (default `http://localhost:4000`) from their `server.ts`, so the browser never needs CORS.
- ShopKart sends `POST /chat` and `POST /lead` to the API; the Control Room sends `POST /analysis` and `POST /campaigns/sync`.
  With `AGENT_URL` set, the API forwards all four unchanged to the agent; if it is unset or unreachable,
  `apps/api/src/agent.ts` answers with a rule-based stand-in.
- The agent acts only through the API's Zendesk / CRM / shop endpoints (listed in `README.md`).
- **`packages/shared/src/types.ts` is the contract.** The agent imports it too; its zod request schemas are in
  `apps/agent/src/service.ts`, so change them together.
- Data lives in Postgres (`DATABASE_URL` in the repo-root `.env`). See "Database" below.
- Seed data: customers 101–105 (shared between ShopKart and Zendesk), tickets #2031–#2040 (new ones from #2041),
  8 contacts and 8 deals, 4 campaigns with 10 responses (incl. spam, a test entry and a duplicate of contact 1). Demo stories are in `README.md` (refund handled by AI, payment escalation, hot sales lead).

## Database (`packages/db`)

- One Postgres for the platform. The demo API owns the demo tables (`packages/db/src/schema.ts`); the agent owns
  `agent_chat_sessions` and VoltAgent's `voltagent_*` memory tables. The agent still acts only through the API.
- Schema change: edit `schema.ts`, run `bun run db:generate`, commit the new file in `packages/db/drizzle/`. The API
  applies pending migrations on startup. Never edit an applied migration.
- Rows map to the `@ph/shared` types in `src/map.ts` (timestamps are `Date` in the DB, ISO strings in the API).
  Import `eq`, `sql`, etc. from `@ph/db`, not `drizzle-orm`, so there's one copy of drizzle.
- `reset` truncates the demo tables (`DEMO_TABLES`) and re-seeds with ids continuing from the old numbers (#2041…).
  It also wipes the agent's tables (`voltagent_*`, `agent_chat_sessions`, found by name via `agentMemoryTables`) so a
  fresh demo has no remembered chats. The agent still checks recycled ticket numbers by `created_at`.
- The DB is remote (~100 ms a round trip): run independent queries with `Promise.all`, avoid per-row queries.

## Agent (`apps/agent`)

- Built on VoltAgent. Four agents: `support` (chats: refunds, tracking, payment escalations), `sales` (enquiries:
  score, stage, book a call), `analysis` (reads `/analytics/metrics`, publishes a report of findings tied to chart
  datasets) and `leads` (per campaign response: create a scored CRM lead or skip spam/duplicates). `src/index.ts` boots VoltAgent + Hono, `src/service.ts` runs a request,
  `src/agents/` instructions, `src/tools/` tools, `src/demo-api.ts` the typed client they act through.
- Split of work: code always opens one ticket per chat session (or a contact + deal per enquiry) and posts the
  agent's final text as the public reply; the agent decides everything in between with its tools.
- Hard rules live in tools, not only prompts: tools read the ticket/customer/deal ids from the VoltAgent operation
  context (`src/tools/context.ts`), never from model arguments, and `start_refund` refuses above ₹1,000.
- If the model call fails, the customer still gets a reply and the ticket is unassigned with a note. Keep that.
- With `DATABASE_URL`, conversation memory (`@voltagent/postgres`) and chat sessions survive agent restarts.
- Models, two tiers (`src/models.ts`): heavy (support, analysis) = `AGENT_MODEL_HEAVY`, else `anthropic/claude-sonnet-5`;
  lite (sales, leads) = `AGENT_MODEL_LITE`, else `AGENT_MODEL`, else `COPILOT_MODEL`, else `openai/gpt-5.6-luna`.
  `CLAUDE_API_KEY` is accepted for `ANTHROPIC_API_KEY`. Agents set no `temperature`: current Claude models reject it.
- Analysis and leads rules in tools/API: findings may only name known dataset ids (`ANALYTICS_DATASETS`), one report
  per run; a lead's deal amount is the response's stated budget (never the model's), a response is converted or skipped
  once (API 409), and an email that already has a contact reuses it. Responses the agent couldn't decide stay `new`.
- Analysis scope: `POST /analysis { scope: "all" | "sales" }`. A sales run sees only `SALES_DATASETS` (pipeline by stage and
  score, campaign performance, contacts by source), `publish_report` refuses findings about other charts, and the report is
  saved with `scope` (`GET /analytics/reports/latest?scope=sales`). Each scope has its own memory thread and note.
  `publish_report` rewrites every ₹ amount with Indian grouping (`indianRupees`), since models drift to ₹603,000.
- Memory: see "Agent memory" below.
- Tests (`bun test`) run the real agents against a fake demo API with `MockLanguageModelV3` from `ai/test`
  scripting the tool calls; keep them standalone.
- Skills: `voltagent-best-practices`, `voltagent-core-reference`, `voltagent-docs-bundle`, `create-voltagent`
  (from github.com/VoltAgent/skills, in `.claude/skills/`). Version-matched docs: `apps/agent/node_modules/@voltagent/core/docs`.

## Agent memory (`apps/agent/src/memory.ts`)

Three layers. Only the first is LLM memory; decisions never rest on it, because tools read live records every run.

1. **Conversation memory** (VoltAgent `Memory`, `@voltagent/postgres`, `voltagent_*` tables; in process without
   `DATABASE_URL`). One store for all agents. Before a run VoltAgent loads the thread's last messages
   (`contextLimit`, default 10); a run is stored as about 2 rows (the prompt, and the reply with its tool calls folded in).
   Threads (userId / conversationId):
   - support: `customer-<id>` / the chat `session_id`. Real multi-turn memory within one chat.
   - sales: `person:<email>` / `sales:<email>`. A second enquiry from the same email sees the first.
   - leads: `person:<email>` / `leads:<email>`. Same person across campaign replies. `syncLeads` runs one person's
     responses one after another (people in parallel) so two runs never share a thread at once.
   - analysis: `control-room` / `control-room-analysis`, run with `contextLimit: 0` (no raw history replay).
   Emails are normalised with `personKey` (trim + lowercase).
2. **Working memory, analysis only** (`analysisMemory`, same storage, conversation scope, stored in
   `voltagent_conversations.metadata.workingMemory`). After each published report the service rewrites it in replace
   mode with `analysisNote()`: last headline, findings, totals, plus the previous headline one level deep. VoltAgent
   puts it in the system prompt; the agent is told not to edit it. Older reports: the `get_previous_reports` tool.
3. **App state, not LLM memory**: `agent_chat_sessions` (chat → ticket), `analysis_reports`, and the demo tables.

Cleanup: `bun run reset` wipes layers 1–2 and the chat sessions. On start and every 6 h the agent deletes threads idle
longer than `AGENT_MEMORY_RETENTION_DAYS` (default 30, `0` = keep forever); messages and steps cascade. `/health`
shows the setting. Memory holds customer messages (names, emails, orders): don't log it or copy it elsewhere.

To change memory: keep thread keys in `service.ts` built from `personKey` / `ANALYSIS_THREAD`, keep the note small
(it is in every analysis prompt), and test with `createAgentMemory(undefined)` (in process) as `test/service.test.ts` does.

## Dashboard (`apps/dashboard`)

- Data comes **only** through `src/api.ts`. Most pages read mock JSON in `src/data/` (timestamps shifted so the newest
  event is always recent); swap function bodies there, keep the return shapes. **Analytics** (`/analytics`, Home area),
  **Sales analytics** (`/sales/analytics`) and **Campaigns** (`/campaigns`) are live: `live.use*()` in `api.ts` polls the
  demo API through `/api` (vite proxies it to `API_URL`; `/api/copilotkit` still goes to :4100). Shapes come from `@ph/shared`.
- The Sales area holds every sales task: Sales analytics (its home: `AnalyticsView scope="sales"`, the sales charts and
  the latest sales report), Leads (mock JSON) and Campaigns (live, runs the leads agent). A new sales page goes there.
- Analytics charts: one y-axis per chart (a second measure goes in the tooltip), `ai`/`human` only for AI vs people,
  `bar` (neutral) for single series, `track` for the remainder of a part-of-whole bar; every chart has a Table view.
- Shared state and the audit log are in `src/store.tsx`; labels/colours/icons per channel, level, status, tool in `src/meta.ts`.
  Data shapes are in `src/types.ts` (keep them in step with `src/data/*.json`).
- TypeScript: new files are `.ts`/`.tsx`. The core (types, api, store, meta, lib, nav, theme, layout, sidebar, `ui`, `Trace`,
  `ToolChain`, Leads, Analytics, Campaigns) is typed; the older pages and `src/copilot/` are still `.jsx` (`allowJs`,
  unchecked). Moving a file to `.tsx` turns checking on for it. Restart Vite after renaming a file: it keeps resolving the old path.
- Navigation is two levels (`src/nav.ts`, `src/components/Sidebar.tsx`): the rail holds the global areas (Home, Support,
  Sales, Connect, Aria) and widens on hover; the panel beside it lists the current area's pages, its filtered views
  (ticket status, lead stage, driven by `?status=` / `?stage=`) and live lists. ⌘B hides the panel. A new page goes in
  one area's `paths` and in `PAGES`.
- The panel is resizable (`src/components/PanelResize.tsx`): drag its edge; under 160px the labels cascade out
  (`.cascade-item` in `index.css`, driven by the live width) and on release it settles into the rail.
- Editable tables use `src/components/DataTable.tsx` (Tickets, Leads): cell cursor, edit on double-click/Enter,
  sortable headers with sliding rows, row selection with bulk actions, undo/redo. It is controlled: pages pass
  `rows` and get `onRowsChange(next, change)`; sync side effects (helpdesk status) there.
- **Theming** (`src/index.css`, `src/theme.tsx`): light is the default token set, `[data-theme="dark"]` on `<html>`
  overrides it. `index.html` sets the attribute before first paint (saved choice, else the OS); the topbar toggle
  switches it. Rules that keep both themes working:
  - Use tokens, never raw `white`/`black`: `bg-canvas` (page), `bg-tray` (card frame), `bg-surface` (panels),
    `bg-raised` (popovers), `slate-*` for text/lines (slate-900 = primary text, slate-200 = border),
    `ink/[alpha]` for hairlines and hovers (`border-ink/[0.07]`, `hover:bg-ink/[0.03]`).
  - Hue `-50/-100/-200` are translucent tints (chips, callouts); `-600/-700` are readable hue text.
  - Recharts can't read CSS vars: chart colours live in a per-theme map (`CHART` in `src/meta.ts`) chosen with `useTheme()`.
- Card pattern: `Panel` in `src/components/ui.tsx` (header in a tinted tray, content in an inset panel).
- Colour carries meaning only: mint (`brand`) = the AI, periwinkle (`human`) = a person, amber = waiting on a human
  gate, red = blocked/critical. Icon tiles are otherwise neutral.
- Icons: lucide-react with a global 1.5 stroke (`LucideProvider` in `src/main.tsx`). Type: Geist + Geist Mono;
  IDs, refs, times and money use the `.ref` mono class.
- No fake controls: every button, filter and switch must do something with the data that exists.

## Ask Aria (CopilotKit generative UI)

- Topbar "Ask Aria" button or ⌘J opens a docked chat (`apps/dashboard/src/copilot/`). Everything CopilotKit
  (provider, tools, panel, its CSS) is one lazy chunk, `AskAria.jsx`, loaded on first open; keep it out of the main bundle.
- Use the v2 API only (`@copilotkit/react-core/v2`, `@copilotkit/runtime/v2`). The `copilotkit` skill points at current docs.
- Generative UI = frontend tools with a `render` drawing cards. Support/approval cards: `tools.jsx` + `cards.jsx` (mock
  store). Sales: `sales.tsx` registers its own tools, cards and context from the live API. Shared card frame: `frame.tsx`.
  The model passes only an id or filter; the card reads the live record, so it can't show invented data. Handlers return
  a short text summary for the model. Live data reaches the model through `useAgentContext` (values must be JSON: use
  `null`, not `undefined`). To add a card: write it (typed, in a `.tsx`), register it, mention it in the runtime prompt
  (`apps/copilot/src/index.ts`).
- Sales tools (all the Sales area can do): `show_deals`, `show_deal`, `show_campaigns`, `show_campaign_responses`,
  `show_sales_analytics`, and two actions that run the real agents, `fetch_campaign_leads` and `run_sales_analysis`.
  Actions keep their outcome by tool call id (`runs` map) for their card, skip replays (`ctx.isReplay`), and the prompt
  says to run them only when asked. Every Sales page is reachable with `open_page`.
- Cards may hold real controls (Approve/Reject call `decideApproval` in the store), never fake ones.
- Theming: `index.css` maps CopilotKit's shadcn tokens onto ours under `.aria-chat`, and the panel gets `.dark` in dark
  mode for CopilotKit's own `dark:` variants. Don't pass `threadId` to `CopilotChat` (it hides the welcome screen); "New chat" remounts it.
- Model: `COPILOT_MODEL` in the repo-root `.env` (`provider/model`). Default `anthropic/claude-opus-5-5` + `ANTHROPIC_API_KEY`.
  Locally it runs on Azure OpenAI: `openai/gpt-5.6-luna` with `OPENAI_BASE_URL=https://<resource>.services.ai.azure.com/openai/v1`
  and `OPENAI_API_KEY`. `GET :4100/health` shows the model, host and whether the key is set. Telemetry is off in the scripts.

## Demo apps (zendesk, hubspot, shopkart)

- They imitate real products on purpose; keep each app's own look (its `src/styles.css` tokens). ResolveAI shows up
  inside them only as the bot: the bot avatar, the "AI" chip and "Powered by ResolveAI" in the shop chat.
- `server.ts` serves `src/index.html` through Bun's bundler; Tailwind comes from `bunfig.toml` (`bun-plugin-tailwind`).
- No Vite in these apps.

## Brand

- The ResolveAI logo lives in one place: `packages/shared/brand/*.svg` (files) and `packages/shared/src/brand.tsx`
  (React: `ResolveAIMark` = icon on tile, `ResolveAIGlyph` = glyph in `currentColor`). Import from
  `@ph/shared/brand`; never redraw it or copy the paths elsewhere. The dashboard favicon is a copy of
  `resolveai-mark.svg`; update it when the mark changes.
- Use `ResolveAIGlyph` wherever the AI is represented (bot avatars, AI chips, "Solved by AI", the Aria tool node).

## Gotchas

- Toolchain: Bun 1.4, TypeScript 7 (catalog in the root `package.json`). The agent uses VoltAgent 2.11 on AI SDK 6.
- Data persists in Postgres across restarts; only `bun run reset` wipes what the agent created. The API fails at
  startup if `DATABASE_URL` is missing or unreachable.
- Ports 3001–3004, 4000, 4100 and 8000 must be free. If the API fails with EADDRINUSE, an earlier instance is still running.
- Screenshots / visual checks: `bunx playwright@1.60.0 screenshot --color-scheme=dark|light …` matches the
  locally installed Chromium; other versions try to download a browser.
- Never commit `.env` (only `.env.example`). Env vars that matter: `DATABASE_URL`, `AGENT_URL`, `API_URL`, `AGENT_MODEL_HEAVY`,
  `AGENT_MODEL_LITE`, `AGENT_MEMORY_RETENTION_DAYS`, and for Ask Aria
  `COPILOT_MODEL`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` + `OPENAI_BASE_URL`. Bun loads the root `.env` in apps/copilot via `--env-file`.
