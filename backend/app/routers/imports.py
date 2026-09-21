"""imports router — T80-Import & Reconciliation."""
from __future__ import annotations

from fastapi import APIRouter

from app.db import q

router = APIRouter(prefix="/api/imports", tags=["imports"])


@router.get("")
def list_imports():
    return q(
        "SELECT * FROM statement_imports ORDER BY created_at DESC"
        )
