"""FastAPI backend (Milestone A skeleton)."""
from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
import eval_type_backport    # noqa: F401, Python 3.9 compat for `|` union syntax

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db import init_db, q
from app.routers import (
    accounts as accounts_r,
    ai as ai_r,
    ai_ask as ai_ask_r,
    anomalies as anomalies_r,
    budgets as budgets_r,
    capture as capture_r,
    categories as categories_r,
    export as export_r,
    inbox as inbox_r,
    imports as imports_r,
    insights as insights_r,
    overview as overview_r,
    streak as streak_r,
    subscriptions as subscriptions_r,
    telegram as telegram_r,
    transactions as transactions_r,
    wallet as wallet_r,
)

log = logging.getLogger("ledger.main")

async def _log422_handler(request: Request, exc: RequestValidationError):
    """Return validation details without persisting the request body."""
    safe = [{"loc": list(e.get("loc", ())), "msg": e.get("msg", "")} for e in exc.errors()[:5]]
    if os.environ.get("LEDGER_DEBUG_VALIDATION", "").lower() in {"1", "true", "yes"}:
        log.warning("validation error path=%s details=%s", request.url.path, safe)
    return JSONResponse(status_code=422, content={"detail": safe})


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    init_db()
    log.info("db ready")
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Ledger by 留百工作室",
        version="1.0.0",
        description="Local-first personal finance ledger with Apple Pay Shortcut ingestion.",
        lifespan=_lifespan,
    )
    cors_origins = [
        origin.strip() for origin in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(RequestValidationError, _log422_handler)

    # ---- meta routes ----
    @app.get("/api/health", tags=["meta"])
    def _health():
        return {"status": "ok", "service": "ledger-api", "version": "1.0.0"}

    @app.get("/api/ping", tags=["meta"])
    def _ping():
        return {"pong": "ok"}

    @app.get("/api/schema", tags=["meta"])
    def _schema_version():
        return {"version": "1.0.0", "spec": "IMPLEMENTATION_PLAN/MILESTONE_A"}

    @app.get("/api/db/tables", tags=["meta"])
    def _db_tables():
        rows = q(
            "SELECT name FROM sqlite_master WHERE type='table' AND "
            "name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        return [r[0] for r in rows]

    # ---- app routers ----
    app.include_router(accounts_r.router)
    app.include_router(ai_r.router)
    app.include_router(ai_ask_r.router)
    app.include_router(anomalies_r.router)
    app.include_router(budgets_r.router)
    app.include_router(capture_r.router)
    app.include_router(categories_r.router)
    app.include_router(export_r.router)
    app.include_router(inbox_r.router)
    app.include_router(imports_r.router)
    app.include_router(insights_r.router)
    app.include_router(overview_r.router)
    app.include_router(streak_r.router)
    app.include_router(subscriptions_r.router)
    app.include_router(telegram_r.router)
    app.include_router(transactions_r.router)
    app.include_router(wallet_r.router)

    return app


app = create_app()
