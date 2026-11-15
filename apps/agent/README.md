# ResolveAI Agent (VoltAgent)

The agent service the demo API forwards `POST /chat`, `/lead`, `/analysis` and `/campaigns/sync` to when `AGENT_URL` is set.
Built on [VoltAgent](https://voltagent.dev/docs) (`@voltagent/core` + `@voltagent/server-hono`), running on Bun.

```sh
bun run dev:agent      # from the repo root: everything, with the API forwarding to this agent on :8000
bun run test:agent     # bun test, no other services or API keys needed
```

Four agents, all registered with VoltAgent:

| Agent | Model tier | Handles | Tools |
| --- | --- | --- | --- |
| `support` | heavy | ShopKart chats | `get_customer_orders`, `get_order`, `update_ticket`, `add_internal_note`, `start_refund`, `escalate_to_human` |
| `sales` | lite | Business enquiries | `update_deal`, `add_deal_note`, `get_free_slots`, `book_meeting` |
| `analysis` | heavy | Control Room "Run analysis" | `get_metrics`, `get_previous_reports`, `publish_report` |
| `leads` | lite | Control Room "Fetch new leads": one run per new campaign response, 3 at a time | `create_lead`, `skip_response` |

What is code and what is the model:

- **Always done in code** (`src/service.ts`): one Zendesk ticket per chat session (follow-ups become customer comments),
  a CRM contact + deal per enquiry, the agent's final text posted on the ticket as the public reply.
- **Decided by the agent**: what the customer needs, which order, refund / escalate / answer, the ticket's subject, type,
  priority and tags; for leads the score, stage, next step and whether to book a call.
- **Guard rails in the tools**, not just the prompt: tools act only on the request's own ticket, customer, deal or
  campaign response (passed through the VoltAgent operation context, never as model arguments); `start_refund` refuses
  above ₹1,000; `publish_report` accepts only known chart datasets and publishes once per run; `create_lead` takes the
  deal amount from the response's stated budget, and the API refuses to decide a response twice.
- **If the model fails** (no key, provider down), the customer still gets a reply, the ticket is unassigned with an
  internal note saying why, and the enquiry's deal gets a note. Demo API errors return 502.

Storage: with `DATABASE_URL` (repo-root `.env`), each chat's conversation memory (`@voltagent/postgres`, `voltagent_*`
tables) and the chat → ticket map (`agent_chat_sessions`) are in Postgres and survive restarts. Without it, both are
in process.

Models (`src/models.ts`), as `provider/model` from the repo-root `.env`:

- **heavy** (support, analysis): `AGENT_MODEL_HEAVY`, else `anthropic/claude-sonnet-5`. Needs `ANTHROPIC_API_KEY`
  (`CLAUDE_API_KEY` works too).
- **lite** (sales, leads): `AGENT_MODEL_LITE`, else `AGENT_MODEL`, else `COPILOT_MODEL`, else `openai/gpt-5.6-luna`.
  `openai/<deployment>` with `OPENAI_BASE_URL` + `OPENAI_API_KEY` runs on Azure OpenAI.

`GET :8000/health` shows both models and whether each key is set. Swagger UI: http://localhost:8000/ui

| File | What's in it |
| --- | --- |
| `src/index.ts` | VoltAgent bootstrap, Hono server, `/health`, `/chat`, `/lead`, `/analysis`, `/campaigns/sync` |
| `src/models.ts` | The heavy and lite model tiers, key lookup |
| `src/service.ts` | Request validation (zod), ticket/deal bookkeeping, running the agents, fallbacks |
| `src/agents/` | `support.ts`, `sales.ts`, `analysis.ts`, `leads.ts`: instructions and settings per agent |
| `src/tools/` | The agents' tools, plus `context.ts` (per-request ids) |
| `src/sessions.ts` | Chat session → ticket store (Postgres, or in memory for tests) |
| `src/demo-api.ts` | Typed client for the Zendesk, CRM and shop endpoints on `API_URL` (default `http://localhost:4000`) |
| `test/service.test.ts` | Real agents and service against a fake demo API and a scripted model (`MockLanguageModelV3`) |

Request and response shapes come from `@ph/shared` (`packages/shared/src/types.ts`), the same types the shop and API use.

To add a tool: write it with `createTool` in `src/tools/`, read ids with `runOf(opts)`, add it to the agent's list, and
say when to use it in the agent's instructions. VoltAgent docs matching the installed version are bundled in
`apps/agent/node_modules/@voltagent/core/docs` (the `voltagent-docs-bundle` skill searches them).
