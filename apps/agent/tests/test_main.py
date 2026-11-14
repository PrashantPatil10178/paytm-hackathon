import json

import httpx
from fastapi.testclient import TestClient

from app.demo_api import DemoAPI
from app.main import app, demo_api


comments: list[dict] = []


def fake_demo_api() -> DemoAPI:
    """Stands in for apps/api so tests don't need it running."""
    next_id = {"ticket": 2041, "contact": 9, "deal": 9}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if req.method == "POST" and path == "/zendesk/tickets":
            return httpx.Response(201, json={"id": next_id["ticket"], "requester": {"id": 101, "name": "Ananya Iyer"}})
        if req.method == "POST" and path.endswith("/comments"):
            comments.append(json.loads(req.content))
            return httpx.Response(201, json={"id": 1})
        if req.method == "POST" and path == "/crm/contacts":
            return httpx.Response(201, json={"id": next_id["contact"]})
        if req.method == "POST" and path == "/crm/deals":
            return httpx.Response(201, json={"id": next_id["deal"]})
        if req.method == "POST" and path.endswith("/notes"):
            return httpx.Response(201, json={"id": 1})
        return httpx.Response(404, json={"error": f"{req.method} {path} not found"})

    return DemoAPI(httpx.AsyncClient(base_url="http://demo", transport=httpx.MockTransport(handler)))


app.dependency_overrides[demo_api] = fake_demo_api
client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_chat_opens_one_ticket_per_session():
    body = {"session_id": "s-test", "customer_id": 101, "message": "My mugs arrived broken"}
    first = client.post("/chat", json=body).json()
    second = client.post("/chat", json={**body, "message": "Hello?"}).json()
    assert first["ticket_id"] == second["ticket_id"] == 2041
    assert "#2041" in first["reply"]
    assert comments[-1] == {"body": "Hello?", "public": True, "author": "Ananya Iyer", "author_type": "customer"}


def test_lead_creates_deal():
    res = client.post(
        "/lead",
        json={
            "name": "Meera Shah",
            "phone": "9800000000",
            "email": "meera@example.com",
            "business_name": "Shah Traders",
            "need": "bulk_order",
            "budget": 50000,
            "start_when": "This month",
        },
    )
    assert res.status_code == 201
    assert res.json() == {"ok": True, "message": "Thanks! Our team will contact you shortly.", "deal_id": 9}


def test_bad_input_is_rejected():
    assert client.post("/chat", json={"session_id": "x", "customer_id": 101}).status_code == 422
