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
| `apps/agent` | The ResolveAI agent service: `POST /chat`, `POST /lead` | 8000 | Python, FastAPI, httpx |
| `packages/shared` | API types, ₹/date formatting, polling hooks, app server helper, **brand (logo)** | – | TS |

## Commands (run from the repo root)

```sh
bun install
bun run dev              # everything; API uses its built-in stand-in agent
bun run dev:agent        # everything, with the API forwarding /chat and /lead to apps/agent on :8000
bun run dev:zendesk      # API + one app (also dev:hubspot, dev:shop, dev:dashboard, dev:api)
bun run reset            # re-seed the demo data. Do this before every demo run.
bun run check-types      # tsc for the TS apps and packages/shared
bun run lint             # oxlint (dashboard)
bun run test:agent       # pytest for apps/agent (no other services needed)
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
- **`packages/shared/src/types.ts` is the contract.** `apps/agent/app/schemas.py` mirrors the chat/lead shapes;
  change both together.
- Seed data: customers 101–105 (shared between ShopKart and Zendesk), tickets #2031–#2040 (new ones from #2041),
  8 contacts and 8 deals. Demo stories are in `README.md` (refund handled by AI, payment escalation, hot sales lead).

## Agent (`apps/agent`)

- `scripts/run.sh` creates `.venv` on first run and reinstalls when `requirements.txt` changes. Override Python with `PYTHON=`.
- `app/main.py` routes and error mapping (demo API down → 502), `app/schemas.py` models,
  `app/demo_api.py` async client (the agent's tools), `app/agent.py` the logic.
- `app/agent.py` is a **placeholder**: it logs each chat to one Zendesk ticket per session and each enquiry to a
  CRM contact + deal. The real reasoning (understand → policy check → act → reply) goes there.
- Tests use `httpx.MockTransport` in place of the demo API; keep it that way so they run standalone.

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
  - Recharts can't read CSS vars: chart colours live in a per-theme map (see `CHART` in `src/pages/Home.jsx`) chosen with `useTheme()`.
- Card pattern: `Panel` in `src/components/ui.jsx` (header in a tinted tray, content in an inset panel).
- Colour carries meaning only: mint (`brand`) = the AI, periwinkle (`human`) = a person, amber = waiting on a human
  gate, red = blocked/critical. Icon tiles are otherwise neutral.
- Icons: lucide-react with a global 1.5 stroke (`LucideProvider` in `src/main.jsx`). Type: Geist + Geist Mono;
  IDs, refs, times and money use the `.ref` mono class.
- No fake controls: every button, filter and switch must do something with the data that exists.

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

- Toolchain: Bun 1.4, TypeScript 7 (catalog in the root `package.json`), Python 3.10+ for the agent (developed on 3.14).
- Data is in memory: restarting the API or running `bun run reset` wipes anything the agent created.
- Ports 3001–3004, 4000 and 8000 must be free. If the API fails with EADDRINUSE, an earlier instance is still running.
- Screenshots / visual checks: `bunx playwright@1.60.0 screenshot --color-scheme=dark|light …` matches the
  locally installed Chromium; other versions try to download a browser.
- Never commit `.env` (only `.env.example`). `AGENT_URL` and `API_URL` are the only env vars that matter.
