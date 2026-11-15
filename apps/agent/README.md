# ResolveAI Agent (VoltAgent)

The agent service the demo API forwards ShopKart chats (to `POST /intake`, with the channel token), `POST /lead`, `/analysis` and `/campaigns/sync` to when `AGENT_URL` is set.
Built on [VoltAgent](https://voltagent.dev/docs) (`@voltagent/core` + `@voltagent/server-hono`), running on Bun.

```sh
bun run dev:agent      # from the repo root: everything, with the API forwarding to this agent on :8000
bun run test:agent     # bun test, no other services or API keys needed
```

Every support request goes through a **main agent**, then one **level agent** (or a person). The other agents work
sales enquiries, analytics and campaign leads:

| Agent | Model tier | Handles | Tools |
| --- | --- | --- | --- |
| `main` | heavy | Every request: new or status check, intent, signals, confidence, plan | none (it decides, others act) |
| `low-direct` | heavy | Information without a ticket: where is my order, delivery, policy questions. Its answer is the chat reply | `get_customer_orders`, `get_order`, `search_past_cases`, `escalate_to_human` (opens the ticket then, with the chat so far) |
| `low` | heavy | Information on a chat that already has a ticket | `get_customer_orders`, `get_order`, `search_past_cases`, `add_internal_note`, `update_ticket`, `escalate_to_human` |
| `medium` | heavy | Actions within limits: refunds up to the auto-refund limit (Control Room setting, default ₹1,000) | the low tools plus `start_refund` |
| `high` | heavy | Refunds above the limit: plan it, a person approves | lookups, `search_past_cases`, `request_approval`, `escalate_to_human` (no direct refunds) |
| critical | – | Failed payments, fraud or legal | none: code assigns a person and writes the brief |
| `writer` | heavy | Short status updates from the ticket's (or an earlier answer's) facts | none |
| `sales` | lite | Business enquiries | `update_deal`, `add_deal_note`, `get_free_slots`, `book_meeting` |
| `analysis` | heavy | Control Room "Run analysis" | `get_metrics`, `get_previous_reports`, `publish_report` |
| `leads` | lite | Control Room "Fetch new leads": one run per new campaign response, 3 at a time | `create_lead`, `skip_response` |

How a request flows (`src/service.ts`):

1. A channel posts to `POST /intake` with `Authorization: Bearer <channel token>` (Control Room → Channels). Unknown
   tokens get 401, turned-off channels 403. A run is opened in the demo API (`/resolveai/runs`).
2. The main agent reads the message with the customer's orders, their open ticket and similar past cases, and returns
   a structured triage. Status checks ("any update?") are answered from the ticket, its latest run and any pending
   approval, without a new ticket.
3. Which order: a refund, damage claim or cancellation is only worked on an order the customer named (number, item,
   a pick from the "which order?" card, the chat ticket's order) or their only order. Otherwise the reply carries
   `ask` (a ChatQuestion card) and nothing is opened; the answer comes back as `answer` with the original message.
4. `src/criticality.ts` sets the level in code: hard rules for money and risk, then signals (angry and contacted us
   repeatedly, asked for a person) and low confidence push it up.
5. **Low** (and the chat has no open ticket): `low-direct` answers in the chat, no ticket and no ack; the run is
   recorded with `ticket_id` null (Control Room → Support → Conversations). If it hands over, `escalate_to_human` opens
   the ticket through the `openTicket` context callback, with the chat's earlier exchanges copied in.
   **Medium and above**: the ticket is opened or updated (one per chat while unsolved; a new problem after a solved one
   gets a new ticket) with the level, who handles it, the priority and an internal triage note; the level agent works
   it in the background, or a person gets it with a brief. `/intake` waits up to 8 s (`ackAfterMs`) for the level agent
   and returns its reply; only a slower one gets "I'm on it: ticket #…" first. Every tool call is a step on the run.
6. The reply goes back to the channel and onto the ticket. Finished cases (resolved, escalated, rejected) are saved
   to memory (`/resolveai/cases`), and `search_past_cases` reads them next time.
7. High-level refunds wait in Approvals. After a person decides, the demo API calls `POST /approvals/:id/decided`;
   the agent runs the refund (or hands it to a person), tells the customer on the ticket and saves the case.

What is code and what is the model:

- **Always done in code** (`src/service.ts`): channel check, ticket or no ticket (low = none), one ticket per chat while unsolved, which order may be acted on, the level (money and risk
  rules), the triage note, the reply on the ticket, audit steps, approvals execution, saving cases; a CRM contact + deal
  per enquiry; the queue of campaign responses.
- **Decided by the agents**: what the customer needs, the plan, and how the level agent resolves it; for
  leads the score, stage, next step and whether to book a call.
- **Guard rails in the tools**, not just the prompt: tools act only on the request's own ticket, customer, deal or
  campaign response (operation context, never model arguments); `start_refund` and `request_approval` refuse an order the customer didn't name (`orderIds` in the run context); `start_refund` refuses above the auto-refund limit (`refundLimit` in the Control Room settings, read through `platform.refundLimit()`, cached 10 s, ₹1,000 when unreachable); the high agent
  has no refund tool at all; `publish_report` accepts only known chart datasets and publishes once per run;
  `create_lead` takes the deal amount from the response's stated budget, and the API refuses to decide a response twice.
- **Connectors**: Zendesk, shop and CRM calls go to the base URL and token set on Control Room → Connectors. A
  connector that is turned off fails with a clear 502. Campaigns and analytics go straight to the demo API.
- **If a model fails**, the customer still gets a reply and the ticket goes to a person with a note; a campaign
  response the agent couldn't decide stays new.

Memory (`src/memory.ts`; full notes in the repo's CLAUDE.md, "Agent memory"): with `DATABASE_URL`, conversation memory
(`@voltagent/postgres`, `voltagent_*` tables) and the chat → ticket map (`agent_chat_sessions`) are in Postgres and
survive restarts; without it, both are in process.

- Threads: support per chat session; sales and leads per person (email), so a returning person is recognised; analysis
  one thread run with no raw history, reading a working-memory note the service rewrites after every report.
- Cleanup: `bun run reset` wipes it with the demo data; threads idle longer than `AGENT_MEMORY_RETENTION_DAYS`
  (default 30, 0 = forever) are deleted on start and every 6 hours.

Models (`src/models.ts`), as `provider/model` from the repo-root `.env`:

- **heavy** (main, level agents, analysis): `AGENT_MODEL_HEAVY`, else `anthropic/claude-sonnet-5`. Needs `ANTHROPIC_API_KEY`
  (`CLAUDE_API_KEY` works too).
- **lite** (writer, sales, leads): `AGENT_MODEL_LITE`, else `AGENT_MODEL`, else `COPILOT_MODEL`, else `openai/gpt-5.6-luna`.
  `openai/<deployment>` with `OPENAI_BASE_URL` + `OPENAI_API_KEY` runs on Azure OpenAI.

`GET :8000/health` shows both models and whether each key is set. Swagger UI: http://localhost:8000/ui

| File | What's in it |
| --- | --- |
| `src/index.ts` | VoltAgent bootstrap, Hono server, `/health`, `/intake`, `/approvals/:id/decided`, `/lead`, `/analysis`, `/campaigns/sync` |
| `src/models.ts` | The heavy and lite model tiers, key lookup |
| `src/memory.ts` | Conversation memory, the analysis working-memory note, thread keys, retention |
| `src/service.ts` | Intake, triage → level → routing, status checks, approvals, case memory, fallbacks; leads, analysis, campaign sync |
| `src/criticality.ts` | The level rules (low / medium / high / critical) and the default ₹1,000 auto-refund limit (the live one comes from the Control Room settings) |
| `src/agents/` | `main.ts` (triage schema, writer), `levels.ts` (low / medium / high), `sales.ts`, `analysis.ts`, `leads.ts` |
| `src/tools/` | `support.ts` (level tools, each records a step), `sales.ts`, `analysis.ts`, `leads.ts`, `context.ts` (per-request ids) |
| `src/platform.ts` | Client for `/resolveai/*`: channel tokens, connectors, runs, steps, approvals, cases |
| `src/sessions.ts` | Chat session → ticket store (Postgres, or in memory for tests) |
| `src/demo-api.ts` | Typed client for Zendesk, CRM and shop, sent to each connector's base URL and token |
| `test/service.test.ts` | Real agents and service against a fake demo API and a scripted model (`MockLanguageModelV3`) |

Request and response shapes come from `@ph/shared` (`packages/shared/src/types.ts`), the same types the shop and API use.

To add a tool: write it with `createTool` in `src/tools/`, read ids with `runOf(opts)`, add it to the agent's list, and
say when to use it in the agent's instructions. VoltAgent docs matching the installed version are bundled in
`apps/agent/node_modules/@voltagent/core/docs` (the `voltagent-docs-bundle` skill searches them).
