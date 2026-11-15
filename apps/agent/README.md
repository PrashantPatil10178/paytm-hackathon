# ResolveAI Agent (VoltAgent)

The agent service the demo API forwards `POST /chat` and `POST /lead` to when `AGENT_URL` is set.
Built on [VoltAgent](https://voltagent.dev/docs) (`@voltagent/core` + `@voltagent/server-hono`), running on Bun.

```sh
bun run dev:agent      # from the repo root: everything, with the API forwarding to this agent on :8000
bun run test:agent     # bun test, no other services or API keys needed
```

Two agents, both registered with VoltAgent:

| Agent | Handles | Tools |
| --- | --- | --- |
| `support` | ShopKart chats | `get_customer_orders`, `get_order`, `update_ticket`, `add_internal_note`, `start_refund`, `escalate_to_human` |
| `sales` | Business enquiries | `update_deal`, `add_deal_note`, `get_free_slots`, `book_meeting` |

What is code and what is the model:

- **Always done in code** (`src/service.ts`): one Zendesk ticket per chat session (follow-ups become customer comments),
  a CRM contact + deal per enquiry, the agent's final text posted on the ticket as the public reply.
- **Decided by the agent**: what the customer needs, which order, refund / escalate / answer, the ticket's subject, type,
  priority and tags; for leads the score, stage, next step and whether to book a call.
- **Guard rails in the tools**, not just the prompt: tools act only on the request's own ticket, customer and deal
  (passed through the VoltAgent operation context, never as model arguments); `start_refund` refuses above ₹1,000.
- **If the model fails** (no key, provider down), the customer still gets a reply, the ticket is unassigned with an
  internal note saying why, and the enquiry's deal gets a note. Demo API errors return 502.

Model: `AGENT_MODEL`, else `COPILOT_MODEL`, else `anthropic/claude-opus-5-5`, as `provider/model`, from the repo-root
`.env`. `openai/<deployment>` with `OPENAI_BASE_URL` + `OPENAI_API_KEY` runs on Azure OpenAI. `GET :8000/health` shows
the model and whether its key is set. Swagger UI: http://localhost:8000/ui

| File | What's in it |
| --- | --- |
| `src/index.ts` | VoltAgent bootstrap, Hono server, `/health`, `/chat`, `/lead` |
| `src/service.ts` | Request validation (zod), ticket/deal bookkeeping, running the agents, fallbacks |
| `src/agents/` | `support.ts`, `sales.ts`: instructions and settings per agent |
| `src/tools/` | The agents' tools, plus `context.ts` (per-request ids) |
| `src/demo-api.ts` | Typed client for the Zendesk, CRM and shop endpoints on `API_URL` (default `http://localhost:4000`) |
| `test/service.test.ts` | Real agents and service against a fake demo API and a scripted model (`MockLanguageModelV3`) |

Request and response shapes come from `@ph/shared` (`packages/shared/src/types.ts`), the same types the shop and API use.

To add a tool: write it with `createTool` in `src/tools/`, read ids with `runOf(opts)`, add it to the agent's list, and
say when to use it in the agent's instructions. VoltAgent docs matching the installed version are bundled in
`apps/agent/node_modules/@voltagent/core/docs` (the `voltagent-docs-bundle` skill searches them).
