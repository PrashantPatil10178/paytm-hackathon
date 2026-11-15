<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/shared/brand/resolveai-logo-dark.svg">
  <img src="packages/shared/brand/resolveai-logo.svg" alt="ResolveAI" height="40">
</picture>

# paytm-hackathon · ResolveAI demo apps

Three look-alike apps for the ResolveAI demo, the ResolveAI Control Room dashboard, and the API they share. The agent creates and updates
tickets and deals through the API, which keeps everything in Postgres; every screen polls every 2 s, so judges watch the work appear.

| App | URL | What it is |
| --- | --- | --- |
| **Zendesk (Demo)** | http://localhost:3001 | Helpdesk: views, ticket list, ticket detail with replies and internal notes |
| **HubSpot CRM (Demo)** | http://localhost:3002 | CRM: deals pipeline (drag and drop), deal detail, contacts |
| **ShopKart** | http://localhost:3003 | Shop: products, My Orders, Help, Business Enquiry, support chat |
| **ResolveAI Control Room** | http://localhost:3004 | ResolveAI's own dashboard: KPIs, audit, tickets, approvals, board, channels, connectors, settings, voice calls, analytics and campaigns, all live from Postgres |
| Demo API | http://localhost:4000 | All endpoints from the build guide, data in Postgres |

Stack: Bun 1.4 (runtime, HTML bundler and dev server with HMR, no Vite), React 19, Tailwind CSS v4 via
`bun-plugin-tailwind`, lucide icons, Turborepo. The Control Room (`apps/dashboard`) is a Vite 8 (Rolldown) app
with React Router, Recharts and dnd-kit; see its own README.

## Run it

```sh
bun install
cp .env.example .env # then set DATABASE_URL (Postgres) and a model key
bun run dev          # API + all three apps + the Control Room
```

The API creates the tables and seeds the demo data the first time it meets an empty database. After that the
data survives restarts; `bun run reset` puts it back to the seed.

Or just one app with the API: `bun run dev:zendesk`, `bun run dev:hubspot`, `bun run dev:shop`. The Control Room alone: `bun run dev:dashboard`.

Other commands:

```sh
bun run reset        # wipe and re-seed the demo data in Postgres (do this before each demo run)
bun run db:migrate   # apply migrations and seed an empty database (the API also does this on start)
bun run db:generate  # write a new SQL migration after changing packages/db/src/schema.ts
bun run db:studio    # browse the tables in Drizzle Studio
bun run check-types
bun run lint         # oxlint (Control Room)
bun run build        # static bundles in apps/*/dist
bun run start        # production mode (bundles once at startup)
```

## Hooking up the real agent

`POST /chat`, `POST /lead`, `POST /analysis` and `POST /campaigns/sync` are the agent's entry points. Set `AGENT_URL`
when starting the API and all four are forwarded there unchanged:

```sh
AGENT_URL=http://localhost:8000 bun run dev   # or: bun run dev:agent
```

The agent lives in `apps/agent` (TypeScript, [VoltAgent](https://voltagent.dev/docs)): a support agent for chats, a
sales agent for enquiries, an analysis agent for the Control Room's Analytics page and a leads agent that turns campaign
responses into CRM leads. Heavy work (support, every customer reply, analysis) runs on `anthropic/claude-sonnet-5`, light work (sales, leads) on
`openai/gpt-5.6-luna`; override with `AGENT_MODEL_HEAVY` / `AGENT_MODEL_LITE`. See its README.

The agent receives exactly what the shop sends and must answer in the same shape:

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST {AGENT_URL}/chat` | `{ session_id, customer_id, message, answer? }` | `{ reply, ticket_id?, ask? }`: no `ticket_id` when Aria answered without a ticket; `ask` = "which order?" card |
| `POST {AGENT_URL}/lead` | `{ name, phone, email, business_name, need, budget, start_when }` | `{ ok, message, deal_id? }` |
| `POST {AGENT_URL}/analysis` | `{ focus? }` | `{ report }` (also saved via `POST /analytics/reports`) |
| `POST {AGENT_URL}/campaigns/sync` | `{ limit? }` (default 10) | `{ processed, converted, skipped, failed, remaining, results[] }` |

Without `AGENT_URL` (or if the agent is unreachable) a small rule-based stand-in answers instead, using
the same Zendesk, CRM, campaign and analytics endpoints. It covers the demo stories so the screens can be built and
rehearsed before the agent is ready.

The agent then calls the endpoints below on `http://localhost:4000`.

## Demo stories

Run `bun run reset` first. In ShopKart (pick the customer top right) open the support chat:

1. **Answered without a ticket.** Arjun: "Where is my order 1031?". Aria looks it up and answers in a few seconds, no
   ticket chip. It shows in the Control Room under Support → Conversations (and in Home's activity and the audit log),
   and counts as a query solved by AI. "Any update?" in the same chat is answered from that answer, still no ticket.
2. **Which order?** Rohan: "My item arrived broken, I want a refund". He has several orders, so Aria asks which item
   (a card with his products) instead of guessing. Pick one and the request continues with that order.
3. **Refund handled by AI.** Ananya: "The coffee mugs in my order 1023 arrived broken". Medium: ticket, refund of ₹500
   started (order 1023 → refund initiated), ticket solved.
4. **Approval.** Rohan: "My headphones from order 1018 stopped working, refund please". High (₹2,499 > ₹1,000): the
   refund waits in Control Room → Approvals; approve it and the refund runs, the ticket is solved and the customer
   is told in the chat.
5. **Payment escalation.** Vikram: "₹15,000 was debited for order 1050 but the payment failed". Critical: ticket assigned
   to Kabir, urgent, with a brief; Aria never acts on it.
6. **Chat with the customer yourself.** Any chat (try Vikram's from story 5) shows live in Control Room → Support →
   Chats. Write a reply there: it appears in the customer's ShopKart chat as Kabir, goes on the Zendesk ticket (one is
   opened, with the chat so far, if the chat had none), and Aria stays quiet while you talk. "Hand back to Aria" or
   "Mark solved" ends it. A public reply on the ticket in Zendesk reaches the chat too.
7. **Hot sales lead.** ShopKart → Business enquiry with a ₹60,000 budget starting this week: contact + deal in HubSpot,
   scored hot, intro call booked with Kabir (IST slots), visible in Control Room → Sales → Leads.

## API

All bodies are JSON. Types live in `packages/shared/src/types.ts`.

### Zendesk

| Method | URL | Notes |
| --- | --- | --- |
| GET | `/zendesk/tickets?view=` | `all_unsolved` · `unassigned` · `assigned_humans` · `recently_solved`. Also returns per-view counts. |
| GET | `/zendesk/tickets/{id}` | Ticket with all comments |
| POST | `/zendesk/tickets` | `{ subject, comment?, requester_id \| requester{name,email,phone}, priority?, type?, status?, assignee?, tags?, via?, order_id? }` |
| PATCH | `/zendesk/tickets/{id}` | `{ subject?, status?, priority?, type?, assignee?, tags?, escalated_by_ai? }` |
| POST | `/zendesk/tickets/{id}/comments` | `{ body, public }`, where `public: false` is an internal note. Author defaults to `ResolveAI Bot`. |
| GET | `/zendesk/users/{id}/tickets` | Other tickets from the same customer |

- `priority` also accepts our levels: `low → Low`, `medium → Normal`, `high → High`, `critical → Urgent`.
- Reassigning a ticket from `ResolveAI Bot` to a person marks it **Escalated by AI** automatically.
- Customer ids are shared with ShopKart (101–105), so `requester_id: customer_id` just works.

### HubSpot CRM

| Method | URL | Notes |
| --- | --- | --- |
| GET / POST | `/crm/contacts` | POST `{ name, email, phone?, company?, owner?, source? }` |
| GET | `/crm/contacts/{id}` | Contact plus their deals |
| GET / POST | `/crm/deals` | POST `{ name, amount, contact_id, stage?, owner?, score?, next_step? }` |
| GET | `/crm/deals/{id}` | Deal, contact and activity timeline |
| PATCH | `/crm/deals/{id}` | `{ stage?, score?, owner?, amount?, next_step?, close_date?, payment_link? }`. Stage changes are logged. |
| POST | `/crm/deals/{id}/notes` | `{ body, type? }`, where type is `note`, `email`, `meeting` or `call`. Author defaults to `ResolveAI Bot`. |
| GET | `/crm/slots` | Free 30-minute slots over the next 3 working days |
| POST | `/crm/meetings` | `{ deal_id, start, duration_min?, title? }` |
| POST | `/crm/deals/{id}/quote` | `{ items: [{ name, qty, unit_price }], status? }`, where status is `draft`, `waiting_approval` or `sent` |

Stages: `new_lead → qualified → meeting_booked → quote_sent → closed_won / closed_lost`. Scores: `hot`, `warm`, `cold`.

### ShopKart

| Method | URL |
| --- | --- |
| GET | `/shop/products` |
| GET | `/shop/customers` |
| GET | `/shop/customers/{id}/orders` |
| GET | `/shop/orders/{id}` |
| POST | `/shop/orders/{id}/refund` (delivered or damaged orders that are paid; marks it damaged, `refund_initiated`) |
| POST | `/chat` |
| GET | `/chat/sessions/{id}` (the stored chat: `{ messages, handler: ai \| human, agent, ticket_id }`; the widget polls it) |
| POST | `/lead` |
| POST | `/admin/reset` (same as `bun run reset`) |

`POST /chat` goes to the agent's `POST /intake` with ShopKart's channel token (`SHOPKART_CHANNEL_TOKEN`, or one the
API issues at startup) when `AGENT_URL` is set. Every chat line is stored in `chat_messages` (`apps/api/src/chats.ts`): the customer's
message, Aria's answer, public replies on the chat's ticket, and a person's messages from the Control Room. While a
person owns the chat's open ticket, `POST /chat` puts the message on their ticket and doesn't call the agent; the reply
is empty while they're talking (they wrote in the last 30 minutes), else a one-line "Kabir is on it".

### ResolveAI (agent config and records)

| Method | URL | Notes |
| --- | --- | --- |
| GET | `/resolveai/channels` | Channels that may send requests. Tokens are stored hashed; only the last 4 characters are returned. |
| PATCH | `/resolveai/channels/{id}` | `{ enabled?, name? }` |
| POST | `/resolveai/channels/{id}/token` | New token, returned once. The old one stops working. |
| POST | `/resolveai/channels/authenticate` | Agent only: `{ token }` → the channel, 401 unknown, 403 turned off |
| GET | `/resolveai/connectors` | Zendesk, ShopKart + Paytm, HubSpot, Sarvam (error until its API key is set): base URL, on/off, live health (`connected` / `error` / `disabled`) |
| PATCH | `/resolveai/connectors/{id}` | `{ base_url?, token?, enabled? }`, then re-checks health |
| POST | `/resolveai/connectors/{id}/check` | Health check now |
| GET | `/resolveai/connectors/access` | Agent only: base URLs and tokens |
| GET / POST | `/resolveai/runs` | One per request: level, who handles it, plan, status, reply. `?ticket_id=` / `?session_id=` filter |
| GET / PATCH | `/resolveai/runs/{id}` | With its steps |
| POST | `/resolveai/runs/{id}/steps` | `{ agent, step, tool, result, detail }`: the audit trail |
| GET / POST | `/resolveai/approvals` | High-level refunds waiting for a person. `?status=pending` |
| POST | `/resolveai/approvals/{id}/decide` | `{ decision: approved \| rejected, decided_by?, note? }`; the agent is told and carries it out |
| GET / POST | `/resolveai/cases` | The main agent's memory of finished cases. `?q=` full-text search |

With `RESOLVEAI_INTERNAL_KEY` set, the agent-only routes need the `x-resolveai-key` header.

### Control Room (`apps/api/src/controlroom.ts`)

What the ResolveAI Control Room reads, built from the live records. Shapes are in `packages/shared/src/controlroom.ts`
(`@ph/shared/controlroom`); the dashboard calls them as `/api/control-room/*`.

| Method | URL | Notes |
| --- | --- | --- |
| GET | `/control-room/tickets` | `{ tickets }`, newest first: Zendesk ticket + comments + requester + order + every run and step on it |
| GET / PATCH | `/control-room/tickets/{id}` | PATCH `{ status: open \| in_progress \| waiting \| solved }` → the Zendesk ticket (waiting = pending). `{ ticket }` |
| GET | `/control-room/chats` | `{ chats }`: every chat (last 30 days), newest activity first, with who answers it (`handler`) and its ticket |
| GET | `/control-room/chats/{id}` | `{ chat, messages }` |
| POST | `/control-room/chats/{id}/messages` | `{ body }` from Kabir. Takes the chat over: its ticket (opened now, chat copied on, if it has none) is assigned to him. `{ chat, messages }` |
| POST | `/control-room/chats/{id}/handback` · `/solve` | Ticket back to the bot, or solved. Each adds a notice to the chat. `{ chat, messages }` |
| GET | `/control-room/conversations` | `{ conversations }`: chats Aria answered without a ticket (one per run, ids `C-<run id>`), newest first |
| GET | `/control-room/leads` | `{ leads }`: CRM deals with their contact, activities and Sarvam calls |
| GET / PATCH | `/control-room/leads/{id}` | PATCH `{ stage? (label or id), value?, name?, company? }` → deal / contact. `{ lead }` |
| GET | `/control-room/approvals` | `{ pending, history }` from `rai_approvals` (ids `AP-<n>`) |
| POST | `/control-room/approvals/{id}/decide` | `{ decision, note? }`, decided by the owner; the agent carries it out. `{ ok, warning? }` |
| GET | `/control-room/stats` | KPIs and sparklines for the last 14 IST days; zeros on an empty database |
| GET / POST | `/control-room/channels` | `{ channels, catalog }`. POST `{ name, kind: webchat \| whatsapp \| email \| api }` adds a channel and returns its token once |
| GET | `/control-room/connectors` | `{ connectors, catalog: [] }` with live health and today's actions |
| GET / PUT | `/control-room/settings` | Aria's settings. `refundLimit` is the auto-refund limit the agent and the stand-in enforce |
| GET / POST | `/control-room/board` | `{ tasks }` by column then position. POST `{ title, owner?, tag?, column? }` appends to the column |
| PATCH / DELETE | `/control-room/board/{id}` | `{ title?, owner?, tag?, column?, position? }`; moving renumbers both columns |

### Voice calls (Sarvam)

Outbound sales calls by the Sarvam voice agent "Aria · Sales Caller". When a call ends, what it collected
becomes a CRM contact + deal + a `call` activity (see CLAUDE.md → Voice calls).

| Method | URL | Notes |
| --- | --- | --- |
| GET | `/resolveai/calls` | `{ calls }`, newest first (100) |
| GET | `/resolveai/calls/{id}` | One call: status, outcome, score, extracted fields, transcript, linked contact/deal |
| POST | `/resolveai/calls` | `{ phone, name, business_name?, deal_id?, force? }`. With `deal_id`, phone/name default to the deal's contact. Indian mobiles only (normalised to `+91…`). 409 on a do-not-call number or outside 09:00–21:00 IST (`force: true` overrides the hours, never the do-not-call list), 503 when Sarvam isn't set up or is turned off, 502 with Sarvam's message if it refuses. |
| POST | `/resolveai/calls/{id}/sync` | Fetch the result from Sarvam's analytics now (also done every 30 s for calls still ringing) |
| POST | `/sarvam/webhook/{token}` | Sarvam's post-call webhook. The per-call token is the credential (401 bad token, 404 unknown call, 409 another attempt id). Answers 202 at once. |
### Campaigns (the leads agent's input)

| Method | URL | Notes |
| --- | --- | --- |
| GET | `/campaigns` | Campaigns with spend, clicks and response counts by status |
| GET | `/campaigns/responses?status=&campaign_id=&limit=` | status is `new`, `converted` or `skipped`. New ones oldest first. |
| GET | `/campaigns/responses/{id}` | The response plus `existing_contact` (the CRM contact with that email, and their deals) |
| POST | `/campaigns/responses/{id}/convert` | `{ score, deal_name, amount, next_step, note }`: contact (reused by email) + deal + timeline note, in one transaction. 409 if already processed. |
| POST | `/campaigns/responses/{id}/skip` | `{ reason }`. 409 if already processed. |
| POST | `/campaigns/sync` | Runs the leads agent over new responses (`{ limit? }`) |

### Analytics

| Method | URL | Notes |
| --- | --- | --- |
| GET | `/analytics/metrics` | Live totals and every chart dataset, computed from Postgres |
| GET / POST | `/analytics/reports` | Latest 10 reports. POST `{ headline, insights: [{ dataset, title, finding, tone }] }`; the totals are snapshotted with it. |
| GET | `/analytics/reports/latest` | `{ report }` or `{ report: null }` |
| POST | `/analysis` | Runs the analysis agent (`{ focus? }`) |

## Demo script

Run `bun run reset`, then open the three apps side by side.

1. **Refund (handled by AI).** In ShopKart, log in as **Ananya Iyer** and open **My Orders**. Click
   **Need help?** on **#1023** and say the mugs arrived broken. The agent refunds ₹500, ticket appears in
   Zendesk as *Solved* with the **AI** tag and an internal note, and #1023 flips to *Refund started*.
2. **Escalation.** Switch to **Vikram Singh** and tap **"₹15,000 debited but payment failed"** in
   the chat. An *Urgent* ticket appears, assigned to *Kabir Malhotra* (the owner) and marked **Escalated by AI**.
3. **Sales.** Fill in **Business Enquiry** with a ₹50,000 budget, starting *This month*. A new
   *Hot* deal lands in HubSpot's **New lead** column and the contact shows up under **Contacts**.
   When the agent moves a deal, its card flies to the new column with a *Moved by ResolveAI* flag.

Seed data (`packages/db/src/seed.ts`): only the shop catalogue (5 customers, 8 products, 12 orders, the customers as
Zendesk users) and the 4 campaigns, with no responses. There are no seeded tickets, contacts, deals or reports: every
record on the screens comes from a real chat, enquiry, call or agent run. New tickets start at #2041, deals and
contacts at 1. Channels, connectors, the Control Room settings and the board are kept across resets.

## Layout

```
apps/
  api/        Bun.serve mock API + agent stand-in (Postgres) :4000
  zendesk/    Zendesk (Demo)                             :3001
  hubspot/    HubSpot CRM (Demo)                         :3002
  shopkart/   ShopKart shop + chat                       :3003
  dashboard/  ResolveAI Control Room (Vite, mock data)   :3004
  agent/      ResolveAI agents (VoltAgent, Bun)          :8000
  copilot/    Ask Aria runtime (CopilotKit)              :4100
packages/
  db/         Postgres: Drizzle schema, migrations, seed data, row → API type mappers
  shared/     API types, ₹/date formatting, polling + router hooks, the app server helper
```

Each demo app's `server.ts` serves `src/index.html` through Bun's bundler (Tailwind via `bunfig.toml`) and
proxies `/api/*` to `API_URL` (default `http://localhost:4000`), so the browser never needs CORS.

Product photos are Unsplash stand-ins stored in `apps/shopkart/public`, so the demo works offline.
