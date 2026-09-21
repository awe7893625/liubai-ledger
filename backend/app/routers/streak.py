"""Streak router — consecutive transaction day tracking."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter

from app.db import q

router = APIRouter(prefix="/api/streak", tags=["streak"])


@router.get("")
def get_streak():
    today = date.today()
    rows = q(
        "SELECT DISTINCT date FROM transactions "
        "WHERE user_id='local' AND status='confirmed' ORDER BY date DESC"
    )
    if not rows:
        return {"current_streak": 0, "longest_streak": 0}

    dates = set(r["date"] for r in rows)

    current = 0
    d = today
    if d.isoformat() not in dates:
        d -= timedelta(days=1)
    while d.isoformat() in dates:
        current += 1
        d -= timedelta(days=1)

    sorted_dates = sorted(date.fromisoformat(dt) for dt in dates)
    longest = 1
    streak = 1
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            streak += 1
            longest = max(longest, streak)
        else:
            streak = 1

    return {"current_streak": current, "longest_streak": longest}
