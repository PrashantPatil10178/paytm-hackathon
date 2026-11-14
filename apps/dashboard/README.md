# ResolveAI · Control Room (UI)

Frontend-only dashboard for ResolveAI, an AI teammate that resolves support and
sales work inside your own tools. All data is mock JSON; there is no backend yet.

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
  api.js              ← the ONLY data layer. Swap each function for fetch() later.
  data/*.json         ← mock tickets, leads, approvals, stats, integrations, settings
  store.jsx           ← shared state (tickets, approvals, settings, toasts) + audit log
  meta.js             ← labels/colours/icons for channels, levels, statuses, tools
  lib.js              ← formatting (₹, times, durations)
  components/
    Layout.jsx        ← sidebar, topbar, ⌘K palette, toasts
    ui.jsx            ← Card, Button, Badge, Drawer, Modal, Tabs, Toggle…
    Trace.jsx         ← step-by-step agent trace timeline
    CommandPalette.jsx
  pages/              ← Home, Audit, Tickets, Approvals, Board, Channels, Connectors, Settings
```

## Wiring the backend later

Pages never import JSON directly; they call `api.*`. Replace the bodies in
`src/api.js` with real requests (same return shapes) and the UI keeps working.
Write calls (`updateTicketStatus`, `decideApproval`, `saveSettings`, `connect`)
are already called at the right moments; today they are no-ops.

Mock timestamps are shifted at load so the newest event always looks recent,
whatever time you run the demo.

## Demo flow that works end to end

1. **Home**: KPIs, AI vs human chart, the "4 actions waiting" banner
2. **Approvals**: approve Rahul's ₹4,250 refund, then use Undo in the toast
3. **Tickets**: RA-1047 is now *Solved by AI* with the new steps in its trace
4. **Board**: drag a ticket between columns; it "syncs" to Zendesk/Freshdesk
5. **Connectors**: *Make primary* on Freshdesk (helpdesk swap, no code), *Add connector*
6. **Settings**: change autonomy or the refund limit; the save bar appears and the sidebar updates
7. Press **⌘K** anywhere to jump to a ticket or page
