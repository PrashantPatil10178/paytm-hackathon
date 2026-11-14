"""The agent's brain. Replace these two functions with the real ResolveAI logic.

For now they do the minimum that proves the wiring: every chat lands in a Zendesk ticket
(one ticket per chat session) and every enquiry becomes a CRM contact plus deal.
"""

from .demo_api import DemoAPI
from .schemas import ChatRequest, ChatResponse, LeadRequest, LeadResponse

NEED_LABELS = {
    "bulk_order": "Bulk order",
    "billing_setup": "Billing setup",
    "payment_setup": "Payment setup",
    "other": "Enquiry",
}

# session_id -> (ticket id, customer name). In memory, so it resets when the agent restarts.
_sessions: dict[str, tuple[int, str]] = {}


async def handle_chat(req: ChatRequest, api: DemoAPI) -> ChatResponse:
    message = req.message.strip()
    session = _sessions.get(req.session_id)

    if session is None:
        subject = message if len(message) <= 60 else message[:57] + "…"
        ticket = await api.create_ticket(
            subject=subject,
            comment=message,
            requester_id=req.customer_id,
            via="chat",
            status="open",
            tags=["chat"],
        )
        ticket_id = ticket["id"]
        _sessions[req.session_id] = (ticket_id, ticket["requester"]["name"])
    else:
        ticket_id, customer_name = session
        await api.add_comment(ticket_id, message, public=True, author=customer_name, author_type="customer")

    # TODO: understand the message, look up orders, decide (refund / escalate / answer), act, reply.
    return ChatResponse(
        reply=f"Thanks for reaching out. I've logged this as ticket #{ticket_id} and will get back to you shortly.",
        ticket_id=ticket_id,
    )


async def handle_lead(req: LeadRequest, api: DemoAPI) -> LeadResponse:
    contact = await api.create_contact(
        name=req.name,
        email=req.email,
        phone=req.phone,
        company=req.business_name,
        source="Business enquiry form",
    )
    deal = await api.create_deal(
        name=f"{req.business_name} – {NEED_LABELS[req.need]}",
        amount=req.budget,
        contact_id=contact["id"],
    )
    # TODO: score the lead, pick the stage and next step, book a meeting or draft a quote.
    await api.add_deal_note(
        deal["id"],
        f"New lead from the business enquiry form. Budget ₹{req.budget:,.0f}. Wants to start: {req.start_when or 'not given'}.",
    )
    return LeadResponse(ok=True, message="Thanks! Our team will contact you shortly.", deal_id=deal["id"])
