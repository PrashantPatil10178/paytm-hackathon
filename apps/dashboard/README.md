# ResolveAI · Control Room (UI)

Frontend-only dashboard for ResolveAI, an AI teammate that resolves support and
sales work inside your own tools. Every page reads live data from the demo API (`apps/api`, Postgres);
run it with `bun run dev:dashboard`, which starts the API too.

## Run

From the repo root:

```bash
bun install
bun run dev:dashboard   # http://localhost:3004
```

## Stack

React 19 + Vite, Tailwind CSS v4, React Router, Recharts, lucide-react, dnd-kit.

## Structure

```
src/
  api.ts              ← the ONLY data layer: polls the demo API's /control-room/*, /resolveai/*, /analytics, /campaigns
  store.tsx           ← shared live state (tickets, leads, approvals, settings, stats), toasts, audit log
  types.ts            ← re-exports the API contract from @ph/shared/controlroom
  meta.ts             ← labels/colours/icons for channels, levels, statuses, tools
  lib.ts              ← formatting (₹, times, durations)
  components/         ← Layout, Sidebar, ui, Trace, DataTable, Calls, AgentAccess, CommandPalette…
  pages/              ← Home, Analytics, Audit, Tickets, Approvals, Board, Leads, Calls, Campaigns, Channels, Connectors, Settings
  copilot/            ← Ask Aria (CopilotKit, lazy chunk)
```

## Demo flow, start to end (after `bun run reset` the Control Room is empty)

1. **ShopKart** (:3003): chat about a broken item → Aria refunds it; ask for a refund above the limit → it waits for approval
2. **Approvals**: approve it as Kabir → Aria refunds and the customer is told in the chat; the ticket is *Solved by AI*
3. **Tickets / Board / Audit**: every step Aria took, from the real runs; status changes sync to Zendesk (:3001)
4. **ShopKart business enquiry** → a scored lead in **Leads** and HubSpot (:3002); **Call with Aria** places a Sarvam call
5. **Settings**: change the refund limit; the agent uses it on the next chat
6. Press **⌘K** anywhere to jump to a ticket or page
