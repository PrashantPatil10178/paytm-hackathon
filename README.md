<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/shared/brand/resolveai-logo-dark.svg">
  <img src="packages/shared/brand/resolveai-logo.svg" alt="ResolveAI" height="40">
</picture>

# paytm-hackathon · ResolveAI demo apps

Three look-alike apps for the ResolveAI demo, the ResolveAI Control Room dashboard, and the API they share. The agent creates and updates
tickets and deals through the API; every screen polls every 2 s, so judges watch the work appear.

| App | URL | What it is |
| --- | --- | --- |
| **Zendesk (Demo)** | http://localhost:3001 | Helpdesk: views, ticket list, ticket detail with replies and internal notes |
| **HubSpot CRM (Demo)** | http://localhost:3002 | CRM: deals pipeline (drag and drop), deal detail, contacts |
| **ShopKart** | http://localhost:3003 | Shop: products, My Orders, Help, Business Enquiry, support chat |
| **ResolveAI Control Room** | http://localhost:3004 | ResolveAI's own dashboard: KPIs, audit, tickets, approvals, board, channels, connectors, settings (mock JSON for now) |
| Demo API | http://localhost:4000 | All endpoints from the build guide, in-memory seed data |

Stack: Bun 1.4 (runtime, HTML bundler and dev server with HMR, no Vite), React 19, Tailwind CSS v4 via
`bun-plugin-tailwind`, lucide icons, Turborepo. The Control Room (`apps/dashboard`) is a Vite 8 (Rolldown) app
with React Router, Recharts and dnd-kit; see its own README.

## Run it

```sh
bun install
bun run dev          # API + all three apps + the Control Room
```

Or just one app with the API: `bun run dev:zendesk`, `bun run dev:hubspot`, `bun run dev:shop`. The Control Room alone: `bun run dev:dashboard`.

Other commands:

```sh
bun run reset        # re-seed the demo data (do this before each demo run)
bun run check-types
bun run lint         # oxlint (Control Room)
bun run build        # static bundles in apps/*/dist
bun run start        # production mode (bundles once at startup)
```

## Hooking up the real agent

`POST /chat` and `POST /lead` are the agent's entry points. Set `AGENT_URL` when starting the API and
both are forwarded there unchanged:

```sh
AGENT_URL=http://localhost:8000 bun run dev   # or: bun run dev:agent
```

The agent lives in `apps/agent` (Python, FastAPI); see its README.

The agent receives exactly what the shop sends and must answer in the same shape:

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST {AGENT_URL}/chat` | `{ session_id, customer_id, message }` | `{ reply, ticket_id? }` |
| `POST {AGENT_URL}/lead` | `{ name, phone, email, business_name, need, budget, start_when }` | `{ ok, message, deal_id? }` |

Without `AGENT_URL` (or if the agent is unreachable) a small rule-based stand-in answers instead, using
the same Zendesk and CRM endpoints. It covers the three demo stories so the screens can be built and
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
| PATCH | `/zendesk/tickets/{id}` | `{ status?, priority?, type?, assignee?, tags?, escalated_by_ai? }` |
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
| POST | `/chat` |
| POST | `/lead` |
| POST | `/admin/reset` |

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

Seed data: 5 customers, 8 products, 12 orders, 10 Zendesk tickets (#2031–#2040), 8 contacts and 8
deals spread across stages. New tickets start at #2041.

## Layout

```
apps/
  api/        Bun.serve mock API + agent stand-in        :4000
  zendesk/    Zendesk (Demo)                             :3001
  hubspot/    HubSpot CRM (Demo)                         :3002
  shopkart/   ShopKart shop + chat                       :3003
  dashboard/  ResolveAI Control Room (Vite, mock data)   :3004
  agent/      ResolveAI agent (Python, FastAPI)          :8000
packages/
  shared/     API types, ₹/date formatting, polling + router hooks, the app server helper
```

Each demo app's `server.ts` serves `src/index.html` through Bun's bundler (Tailwind via `bunfig.toml`) and
proxies `/api/*` to `API_URL` (default `http://localhost:4000`), so the browser never needs CORS.

Product photos are Unsplash stand-ins stored in `apps/shopkart/public`, so the demo works offline.
