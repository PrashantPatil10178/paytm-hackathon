# ResolveAI Agent (VoltAgent)

The agent service the demo API forwards ShopKart chats (to `POST /intake`, with the channel token) and `POST /lead` to when `AGENT_URL` is set.
Built on [VoltAgent](https://voltagent.dev/docs) (`@voltagent/core` + `@voltagent/server-hono`), running on Bun.

```sh
bun run dev:agent      # from the repo root: everything, with the API forwarding to this agent on :8000
bun run test:agent     # bun test, no other services or API keys needed
```

Every request goes through a **main agent**, then one **level agent** (or a person):

| Agent | Handles | Tools |
| --- | --- | --- |
| `main` | Every request: new or status check, intent, signals, confidence, plan | none (it decides, others act) |
| `low` | Information: where is my order, questions | `get_customer_orders`, `get_order`, `search_past_cases`, `add_internal_note`, `update_ticket`, `escalate_to_human` |
| `medium` | Actions within limits: refunds up to ₹1,000 | the low tools plus `start_refund` |
| `high` | Refunds above ₹1,000: plan it, a person approves | lookups, `search_past_cases`, `request_approval`, `escalate_to_human` (no direct refunds) |
| critical | Failed payments, fraud or legal | none: code assigns a person and writes the brief |
| `sales` | Business enquiries | `update_deal`, `add_deal_note`, `get_free_slots`, `book_meeting` |

How a request flows (`src/service.ts`):

1. A channel posts to `POST /intake` with `Authorization: Bearer <channel token>` (Control Room → Channels). Unknown
   tokens get 401, turned-off channels 403. A run is opened in the demo API (`/resolveai/runs`).
2. The main agent reads the message with the customer's orders, their open ticket and similar past cases, and returns
   a structured triage. Status checks ("any update?") are answered from the ticket, its latest run and any pending
   approval, without a new ticket.
3. `src/criticality.ts` sets the level in code: hard rules for money and risk, then signals (angry and contacted us
   repeatedly, asked for a person) and low confidence push it up.
4. The ticket is opened or updated with the level, who handles it, the priority and an internal triage note.
5. The level agent works it with its own tools, or a person gets it with a brief. Every tool call is a step on the run.
6. The reply goes back to the channel and onto the ticket. Finished cases (resolved, escalated, rejected) are saved
   to memory (`/resolveai/cases`), and `search_past_cases` reads them next time.
7. High-level refunds wait in Approvals. After a person decides, the demo API calls `POST /approvals/:id/decided`;
   the agent runs the refund (or hands it to a person), tells the customer on the ticket and saves the case.

What is code and what is the model:

- **Always done in code**: channel check, one ticket per chat session, the level (money and risk rules), the triage
  note, the reply on the ticket, audit steps, approvals execution, saving cases.
- **Decided by the agents**: what the customer needs, which order, the plan, and how the level agent resolves it.
- **Guard rails in the tools**: tools act only on the request's own ticket and customer (operation context, never
  model arguments); `start_refund` refuses above ₹1,000; the high agent has no refund tool at all.
- **Connectors**: every call goes to the base URL and token set on Control Room → Connectors. A connector that is
  turned off fails with a clear 502.
- **If a model fails**, the customer still gets a reply and the ticket goes to a person with a note.

Storage: with `DATABASE_URL` (repo-root `.env`), each chat's conversation memory (`@voltagent/postgres`, `voltagent_*`
tables) and the chat → ticket map (`agent_chat_sessions`) are in Postgres and survive restarts. Without it, both are
in process.

Model: `AGENT_MODEL`, else `COPILOT_MODEL`, else `anthropic/claude-opus-5-5`, as `provider/model`, from the repo-root
`.env`. `openai/<deployment>` with `OPENAI_BASE_URL` + `OPENAI_API_KEY` runs on Azure OpenAI. `GET :8000/health` shows
the model and whether its key is set. Swagger UI: http://localhost:8000/ui

| File | What's in it |
| --- | --- |
| `src/index.ts` | VoltAgent bootstrap, Hono server, `/health`, `/intake`, `/approvals/:id/decided`, `/lead` |
| `src/service.ts` | Intake, triage → level → routing, status checks, approvals, memory, fallbacks; leads |
| `src/criticality.ts` | The level rules (low / medium / high / critical) and the ₹1,000 auto-refund limit |
| `src/agents/` | `main.ts` (triage schema), `levels.ts` (low / medium / high), `sales.ts` |
| `src/tools/` | `support.ts` (level tools, each records a step), `sales.ts`, `context.ts` (per-request ids) |
| `src/platform.ts` | Client for `/resolveai/*`: channel tokens, connectors, runs, steps, approvals, cases |
| `src/sessions.ts` | Chat session → ticket store (Postgres, or in memory for tests) |
| `src/demo-api.ts` | Typed client for Zendesk, CRM and shop, sent to each connector's base URL and token |
| `test/service.test.ts` | Real agents and service against a fake demo API and a scripted model (`MockLanguageModelV3`) |

Request and response shapes come from `@ph/shared` (`packages/shared/src/types.ts`), the same types the shop and API use.

To add a tool: write it with `createTool` in `src/tools/`, read ids with `runOf(opts)`, add it to the agent's list, and
say when to use it in the agent's instructions. VoltAgent docs matching the installed version are bundled in
`apps/agent/node_modules/@voltagent/core/docs` (the `voltagent-docs-bundle` skill searches them).
