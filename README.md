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
| **ResolveAI Control Room** | http://localhost:3004 | ResolveAI's own dashboard: KPIs, audit, tickets, approvals, board, channels, connectors, settings (mock JSON), plus live **Analytics** and **Campaigns** pages |
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
responses into CRM leads. Heavy work (support, analysis) runs on `anthropic/claude-sonnet-5`, light work (sales, leads) on
`openai/gpt-5.6-luna`; override with `AGENT_MODEL_HEAVY` / `AGENT_MODEL_LITE`. See its README.

The agent receives exactly what the shop sends and must answer in the same shape:

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST {AGENT_URL}/chat` | `{ session_id, customer_id, message, channel? }` (`channel: "voice"` for phone calls) | `{ reply, ticket_id? }` |
| `POST {AGENT_URL}/lead` | `{ name, phone, email, business_name, need, budget, start_when }` | `{ ok, message, deal_id? }` |
| `POST {AGENT_URL}/analysis` | `{ focus? }` | `{ report }` (also saved via `POST /analytics/reports`) |
| `POST {AGENT_URL}/campaigns/sync` | `{ limit? }` (default 10) | `{ processed, converted, skipped, failed, remaining, results[] }` |

Without `AGENT_URL` (or if the agent is unreachable) a small rule-based stand-in answers instead, using
the same Zendesk, CRM, campaign and analytics endpoints. It covers the demo stories so the screens can be built and
rehearsed before the agent is ready.

The agent then calls the endpoints below on `http://localhost:4000`.

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
| POST | `/lead` |
| POST | `/admin/reset` (same as `bun run reset`) |

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

### Phone line (Sarvam voice agent)

A Sarvam voice agent answers the ShopKart number and handles the speech, the language and the telephony.
ResolveAI decides what to do: each question the caller asks goes to the same support agent as the shop chat, so a
call opens one Zendesk ticket (`via: "voice"`) and refunds keep the ₹1,000 limit. The Control Room shows calls live
under **Connect → Phone line**.

| Method | URL | Called by | Notes |
| --- | --- | --- | --- |
| POST | `/voice/caller` | Sarvam API tool, run `on_start` | `{ phone, interaction_id? }` → `{ known, customer_id, first_name, orders_summary, greeting }`. Save these as agent variables. |
| POST | `/voice/turn` | Sarvam API tool `ask_resolveai`, run mid-call | `{ interaction_id, phone, message, account? }` → `{ reply, ticket_id, customer_id }`. Say `reply` as is. |
| POST | `/voice/calls` | Sarvam inbound deployment `webhook_config` | The call-completion payload. Puts the transcript on the call's ticket, or opens a ticket for a person if Aria never acted. Retries are ignored. |
| GET | `/voice/calls` | Control Room | Calls, newest first (`?limit=`, default 50) |
| GET | `/voice/line` | Control Room | Number, public URL, today's counts, calls live now |

The caller is matched by the last 10 digits of their number. If that fails, `account` (or the message) can name a
registered mobile number, an email or an order number. Unknown callers are asked for one.
For a demo from your own phone, set `VOICE_DEFAULT_CUSTOMER_ID` to answer them as that customer.

Setup:

1. Sarvam has to reach the API: `ngrok http 4000`, then set `VOICE_PUBLIC_URL` to the https URL and restart the API.
2. Set `VOICE_WEBHOOK_SECRET` and add it to each Sarvam tool as a bearer token (Auth). Set `VOICE_NUMBER` to the line's number.
3. In Sarvam Voice Agents, add the two API tools and point the inbound deployment's webhook at `/voice/calls`.
   Tell the agent to call `ask_resolveai` for anything about orders, refunds, payments or delivery, and to say its
   reply. The Phone line page lists the exact URLs with copy buttons.

### Request forms (details to collect in the chat)

When it isn't clear which order a customer means or what went wrong, Aria sends a form into the ShopKart chat
instead of guessing: the customer taps the order, picks what went wrong and can add a photo. The team sets the forms
up under **Support → Request forms** (which details each asks for, which are required, whether Aria may send it) and
can send one from any open chat ticket as a person. The chat also shows replies a person writes on the ticket.

| Method | URL | Notes |
| --- | --- | --- |
| GET | `/info/forms` | The forms (`damaged_item`, `payment_problem`, `delivery_issue` to start with) |
| PATCH | `/info/forms/:id` | `{ ask?, use_for?, active?, fields?: [{ key, enabled?, required? }] }` |
| GET | `/info/requests` | Forms sent into chats, newest first (`?ticket_id=`, `?status=waiting\|answered\|withdrawn`) |
| POST | `/info/requests` | `{ ticket_id, form_id, requested_by?, order_ids? }`. Without `requested_by` it's Aria, who may only send active forms. The order choices are fixed to the customer's orders when it's sent. Withdraws any form still waiting on that ticket and sets the ticket to pending. |
| POST | `/info/requests/:id/answer` | `{ answers: { [field key]: value } }` → `{ request, summary, to_aria }`. Answers must be one of the choices; a photo is a JPEG/PNG/WebP data URL. If Aria asked and still has the ticket, the chat sends `summary` on to her; otherwise it goes on the ticket for the person. |
| POST | `/info/requests/:id/withdraw` | Takes back a form that is still waiting |

## Demo script

Run `bun run reset`, then open the three apps side by side.

1. **Refund (handled by AI).** In ShopKart, log in as **Ananya Iyer** and open **My Orders**. Click
   **Need help?** on **#1023** and say the mugs arrived broken. The agent refunds ₹500, ticket appears in
   Zendesk as *Solved* with the **AI** tag and an internal note, and #1023 flips to *Refund started*.
2. **Escalation.** Switch to **Vikram Singh** and tap **"₹15,000 debited but payment failed"** in
   the chat. An *Urgent* ticket appears, assigned to *Priya – Support* and marked **Escalated by AI**.
3. **Sales.** Fill in **Business Enquiry** with a ₹50,000 budget, starting *This month*. A new
   *Hot* deal lands in HubSpot's **New lead** column and the contact shows up under **Contacts**.
   When the agent moves a deal, its card flies to the new column with a *Moved by ResolveAI* flag.

4. **Phone call.** Call the ShopKart number (Sarvam) and say an order arrived damaged. Aria answers by voice, the ticket
   appears in Zendesk *via Phone call*, and **Connect → Phone line** shows the call live. When you hang up, the
   transcript lands on the ticket.
5. **Aria asks instead of guessing.** Switch to **Rohan Mehta** (no damaged order) and tap **"Item damaged, I want a
   refund"**. Aria sends the *Damaged or wrong item* form: tap the headphones, pick *Arrived broken*, add a photo, send.
   The answers come back to Aria (₹2,499 is above the limit, so she hands it to Priya), and **Support → Request forms**
   shows the form and its answers. From there, send a form to an open chat as Priya: it appears in the customer's chat.

Seed data (`packages/db/src/seed.ts`): 5 customers, 8 products, 12 orders, 10 Zendesk tickets (#2031–#2040), 8 contacts and 8
deals spread across stages. New tickets start at #2041.

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
