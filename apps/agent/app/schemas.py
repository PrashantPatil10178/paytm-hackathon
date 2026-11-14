"""Request and response shapes. They mirror packages/shared/src/types.ts, which the shop and demo API use."""

from typing import Literal

from pydantic import BaseModel, EmailStr, Field

EnquiryNeed = Literal["bulk_order", "billing_setup", "payment_setup", "other"]


class ChatRequest(BaseModel):
    session_id: str = Field(min_length=1)
    customer_id: int
    message: str = Field(min_length=1)


class ChatResponse(BaseModel):
    reply: str
    ticket_id: int | None = None


class LeadRequest(BaseModel):
    name: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    email: EmailStr
    business_name: str = Field(min_length=1)
    need: EnquiryNeed
    budget: float = 0
    start_when: str = ""


class LeadResponse(BaseModel):
    ok: bool
    message: str
    deal_id: int | None = None
