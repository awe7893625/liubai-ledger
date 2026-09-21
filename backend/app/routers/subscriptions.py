"""Subscriptions router — recurring charge detection."""
from __future__ import annotations

from fastapi import APIRouter

from app.services.subscriptions import detect_subscriptions

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])


@router.get("")
def list_subscriptions():
    return detect_subscriptions()
