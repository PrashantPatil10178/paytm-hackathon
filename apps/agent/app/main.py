from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from . import agent
from .config import get_settings
from .demo_api import DemoAPI, DemoAPIError
from .schemas import ChatRequest, ChatResponse, LeadRequest, LeadResponse


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    async with httpx.AsyncClient(base_url=settings.api_url, timeout=settings.request_timeout_s) as client:
        app.state.demo_api = DemoAPI(client)
        yield


app = FastAPI(title="ResolveAI Agent", version="0.1.0", lifespan=lifespan)


def demo_api(request: Request) -> DemoAPI:
    return request.app.state.demo_api


DemoAPIDep = Annotated[DemoAPI, Depends(demo_api)]


@app.exception_handler(DemoAPIError)
async def demo_api_error(_: Request, exc: DemoAPIError) -> JSONResponse:
    return JSONResponse({"error": f"Demo API said: {exc.message}"}, status_code=502)


@app.exception_handler(httpx.TransportError)
async def demo_api_down(_: Request, exc: httpx.TransportError) -> JSONResponse:
    return JSONResponse({"error": f"Can't reach the demo API at {get_settings().api_url}: {exc}"}, status_code=502)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat")
async def chat(req: ChatRequest, api: DemoAPIDep) -> ChatResponse:
    return await agent.handle_chat(req, api)


@app.post("/lead", status_code=201)
async def lead(req: LeadRequest, api: DemoAPIDep) -> LeadResponse:
    return await agent.handle_lead(req, api)
