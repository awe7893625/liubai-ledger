"""Anomalies router — unusual spending detection."""
from __future__ import annotations

from fastapi import APIRouter

from app.services.anomaly import list_anomalies

router = APIRouter(prefix="/api/anomalies", tags=["anomalies"])


@router.get("")
def get_anomalies():
    return list_anomalies()
