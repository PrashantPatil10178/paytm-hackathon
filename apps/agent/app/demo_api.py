"""Thin async client for the demo API (apps/api). These are the tools the agent acts through."""

from typing import Any

import httpx

BOT = "ResolveAI Bot"


class DemoAPIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"{status}: {message}")
        self.status = status
        self.message = message


class DemoAPI:
    def __init__(self, client: httpx.AsyncClient):
        self._http = client

    async def _call(self, method: str, path: str, json: Any = None, params: dict | None = None) -> Any:
        res = await self._http.request(method, path, json=json, params=params)
        if res.is_error:
            try:
                message = res.json().get("error", res.text)
            except ValueError:
                message = res.text
            raise DemoAPIError(res.status_code, message)
        return res.json()

    # ── Shop ──
    async def customer_orders(self, customer_id: int) -> Any:
        return await self._call("GET", f"/shop/customers/{customer_id}/orders")

    async def order(self, order_id: int) -> Any:
        return await self._call("GET", f"/shop/orders/{order_id}")

    # ── Zendesk ──
    async def ticket(self, ticket_id: int) -> Any:
        return await self._call("GET", f"/zendesk/tickets/{ticket_id}")

    async def create_ticket(self, **body: Any) -> Any:
        return await self._call("POST", "/zendesk/tickets", json=body)

    async def update_ticket(self, ticket_id: int, **changes: Any) -> Any:
        return await self._call("PATCH", f"/zendesk/tickets/{ticket_id}", json=changes)

    async def add_comment(self, ticket_id: int, body: str, public: bool, **extra: Any) -> Any:
        return await self._call("POST", f"/zendesk/tickets/{ticket_id}/comments", json={"body": body, "public": public, **extra})

    # ── CRM ──
    async def create_contact(self, **body: Any) -> Any:
        return await self._call("POST", "/crm/contacts", json=body)

    async def create_deal(self, **body: Any) -> Any:
        return await self._call("POST", "/crm/deals", json=body)

    async def update_deal(self, deal_id: int, **changes: Any) -> Any:
        return await self._call("PATCH", f"/crm/deals/{deal_id}", json=changes)

    async def add_deal_note(self, deal_id: int, body: str, type: str = "note") -> Any:
        return await self._call("POST", f"/crm/deals/{deal_id}/notes", json={"body": body, "type": type})
