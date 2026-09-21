"""telegram router — T50-Telegram."""
from __future__ import annotations

from fastapi import APIRouter

from app.db import q, q1

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


@router.get("")
def list_telegram_events():
    return q(
         "SELECT * FROM telegram_events ORDER BY created_at DESC"
         )


@router.get("/{eid}")
def get_telegram_event(eid: str):
    r = q1("SELECT * FROM telegram_events WHERE id=?", eid)
    if not r:
        from fastapi import HTTPException
        raise HTTPException(404, "telegram event not found")
    return dict(r)
