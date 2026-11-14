# ResolveAI Agent (FastAPI)

The agent service the demo API forwards `POST /chat` and `POST /lead` to when `AGENT_URL` is set.

```sh
bun run dev:agent      # from the repo root: everything, with the API forwarding to this agent on :8000
bun run test:agent     # pytest, no other services needed
```

The first run creates `.venv` with `python3` (override with `PYTHON=python3.13`) and installs
`requirements.txt`. It reinstalls whenever that file changes. Interactive API docs: http://localhost:8000/docs

| File | What's in it |
| --- | --- |
| `app/main.py` | FastAPI app, routes, error handling |
| `app/schemas.py` | Request/response models, mirroring `packages/shared/src/types.ts` |
| `app/agent.py` | The agent logic. **Placeholder for now:** logs each chat to a Zendesk ticket and each enquiry to a CRM deal. |
| `app/demo_api.py` | Async client for the Zendesk, CRM and shop endpoints on `API_URL` (default `http://localhost:4000`) |
| `app/config.py` | Settings, read from env and the root `.env` |
