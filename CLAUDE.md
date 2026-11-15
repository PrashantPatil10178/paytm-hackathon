# ResolveAI · Paytm hackathon monorepo

ResolveAI is an AI teammate ("Aria") that resolves customer-support tickets and sales leads inside a
company's own tools. This repo is the demo stage: look-alike Zendesk, HubSpot and shop apps, a shared
mock API they all read and write, the ResolveAI Control Room dashboard, and the agent service.
Judges watch the agent's work appear live, so the screens matter as much as the logic.

## Layout

| Path | What | Port | Stack |
| --- | --- | --- | --- |
| `apps/api` | Mock API (Zendesk, CRM, shop) + rule-based agent stand-in. In-memory seed data. | 4000 | Bun.serve |
| `apps/zendesk` | Zendesk look-alike: views, tickets, replies, internal notes | 3001 | Bun HTML bundler, React 19, Tailwind v4 |
| `apps/hubspot` | HubSpot CRM look-alike: deals pipeline (drag and drop), contacts | 3002 | same |
| `apps/shopkart` | Customer side: shop, My Orders, support chat, business enquiry | 3003 | same |
| `apps/dashboard` | ResolveAI Control Room (KPIs, audit, tickets, approvals, board, connectors, settings) | 3004 | Vite 8, React 19 (JSX), Tailwind v4, Recharts |
| `apps/agent` | The ResolveAI agents (support + sales): `POST /chat`, `POST /lead` | 8000 | Bun, VoltAgent (`@voltagent/core`, `server-hono`) |
| `apps/copilot` | CopilotKit runtime behind the dashboard's "Ask Aria" chat (`/api/copilotkit`) | 4100 | Bun, `@copilotkit/runtime/v2` |
| `packages/shared` | API types, ₹/date formatting, polling hooks, app server helper, **brand (logo)** | – | TS |

## Commands (run from the repo root)

```sh
bun install
bun run dev              # everything; API uses its built-in stand-in agent
bun run dev:agent        # everything, with the API forwarding /chat and /lead to apps/agent on :8000
bun run dev:zendesk      # API + one app (also dev:hubspot, dev:shop, dev:api)
bun run dev:dashboard    # dashboard + the Ask Aria runtime (apps/copilot)
bun run reset            # re-seed the demo data. Do this before every demo run.
bun run check-types      # tsc for the TS apps and packages/shared
bun run lint             # oxlint (dashboard)
bun run test:agent       # bun test for apps/agent (no other services or API keys needed)
bun run build
```

Long-running servers: start them in a visible VS Code terminal with `vsterm` (see the user's global
instructions), not as hidden background jobs.

## How the pieces talk

- Every demo screen polls the API every 2 s (`packages/shared/src/react.ts`), so changes appear without refresh.
- Demo apps proxy `/api/*` to `API_URL` (default `http://localhost:4000`) from their `server.ts`, so the browser never needs CORS.
- ShopKart sends `POST /chat` and `POST /lead` to the API. With `AGENT_URL` set, the API forwards them unchanged
  to the agent; if it is unset or unreachable, `apps/api/src/agent.ts` answers with a rule-based stand-in.
- The agent acts only through the API's Zendesk / CRM / shop endpoints (listed in `README.md`).
- **`packages/shared/src/types.ts` is the contract.** The agent imports it too; its zod request schemas are in
  `apps/agent/src/service.ts`, so change them together.
- Seed data: customers 101–105 (shared between ShopKart and Zendesk), tickets #2031–#2040 (new ones from #2041),
  8 contacts and 8 deals. Demo stories are in `README.md` (refund handled by AI, payment escalation, hot sales lead).

## Agent (`apps/agent`)

- Built on VoltAgent. Two agents: `support` (chats: refunds, tracking, payment escalations) and `sales` (enquiries:
  score, stage, book a call). `src/index.ts` boots VoltAgent + Hono, `src/service.ts` runs a request,
  `src/agents/` instructions, `src/tools/` tools, `src/demo-api.ts` the typed client they act through.
- Split of work: code always opens one ticket per chat session (or a contact + deal per enquiry) and posts the
  agent's final text as the public reply; the agent decides everything in between with its tools.
- Hard rules live in tools, not only prompts: tools read the ticket/customer/deal ids from the VoltAgent operation
  context (`src/tools/context.ts`), never from model arguments, and `start_refund` refuses above ₹1,000.
- If the model call fails, the customer still gets a reply and the ticket is unassigned with a note. Keep that.
- Model: `AGENT_MODEL`, else `COPILOT_MODEL`, else `anthropic/claude-opus-5-5` (same keys as Ask Aria).
- Tests (`bun test`) run the real agents against a fake demo API with `MockLanguageModelV3` from `ai/test`
  scripting the tool calls; keep them standalone.
- Skills: `voltagent-best-practices`, `voltagent-core-reference`, `voltagent-docs-bundle`, `create-voltagent`
  (from github.com/VoltAgent/skills, in `.claude/skills/`). Version-matched docs: `apps/agent/node_modules/@voltagent/core/docs`.

## Dashboard (`apps/dashboard`)

- Data comes **only** through `src/api.js` (mock JSON in `src/data/`, timestamps shifted so the newest event is
  always recent). It is not wired to the live API yet; swap function bodies there, keep the return shapes.
- Shared state and the audit log are in `src/store.jsx`; labels/colours/icons per channel, level, status, tool in `src/meta.js`.
- **Theming** (`src/index.css`, `src/theme.jsx`): light is the default token set, `[data-theme="dark"]` on `<html>`
  overrides it. `index.html` sets the attribute before first paint (saved choice, else the OS); the topbar toggle
  switches it. Rules that keep both themes working:
  - Use tokens, never raw `white`/`black`: `bg-canvas` (page), `bg-tray` (card frame), `bg-surface` (panels),
    `bg-raised` (popovers), `slate-*` for text/lines (slate-900 = primary text, slate-200 = border),
    `ink/[alpha]` for hairlines and hovers (`border-ink/[0.07]`, `hover:bg-ink/[0.03]`).
  - Hue `-50/-100/-200` are translucent tints (chips, callouts); `-600/-700` are readable hue text.
  - Recharts can't read CSS vars: chart colours live in a per-theme map (`CHART` in `src/meta.js`) chosen with `useTheme()`.
- Card pattern: `Panel` in `src/components/ui.jsx` (header in a tinted tray, content in an inset panel).
- Colour carries meaning only: mint (`brand`) = the AI, periwinkle (`human`) = a person, amber = waiting on a human
  gate, red = blocked/critical. Icon tiles are otherwise neutral.
- Icons: lucide-react with a global 1.5 stroke (`LucideProvider` in `src/main.jsx`). Type: Geist + Geist Mono;
  IDs, refs, times and money use the `.ref` mono class.
- No fake controls: every button, filter and switch must do something with the data that exists.

## Ask Aria (CopilotKit generative UI)

- Topbar "Ask Aria" button or ⌘J opens a docked chat (`apps/dashboard/src/copilot/`). Everything CopilotKit
  (provider, tools, panel, its CSS) is one lazy chunk, `AskAria.jsx`, loaded on first open; keep it out of the main bundle.
- Use the v2 API only (`@copilotkit/react-core/v2`, `@copilotkit/runtime/v2`). The `copilotkit` skill points at current docs.
- Generative UI = frontend tools with a `render` (`tools.jsx`) drawing cards from `cards.jsx`. The model passes only an id or
  filter; the card reads the live record from the store, so it can't show invented data. Handlers return a short text
  summary for the model. Live data reaches the model through `useAgentContext`. To add a card: write it in `cards.jsx`,
  register it in `tools.jsx`, mention it in the runtime prompt (`apps/copilot/src/index.ts`).
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
- Data is in memory: restarting the API or running `bun run reset` wipes anything the agent created.
- Ports 3001–3004, 4000, 4100 and 8000 must be free. If the API fails with EADDRINUSE, an earlier instance is still running.
- Screenshots / visual checks: `bunx playwright@1.60.0 screenshot --color-scheme=dark|light …` matches the
  locally installed Chromium; other versions try to download a browser.
- Never commit `.env` (only `.env.example`). Env vars that matter: `AGENT_URL`, `API_URL`, `AGENT_MODEL`, and for Ask Aria
  `COPILOT_MODEL`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` + `OPENAI_BASE_URL`. Bun loads the root `.env` in apps/copilot via `--env-file`.
