"""Subscription detection: find recurring monthly charges."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from app.db import q


def detect_subscriptions() -> list[dict]:
    rows = q(
        "SELECT merchant_normalized, amount, date FROM transactions "
        "WHERE status='confirmed' AND kind IN ('expense','unknown') "
        "AND merchant_normalized IS NOT NULL AND amount < 0 "
        "ORDER BY merchant_normalized, date"
    )
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[r["merchant_normalized"]].append({
            "amount": abs(int(r["amount"])),
            "date": r["date"],
        })

    result = []
    for merchant, txns in groups.items():
        if len(txns) < 3:
            continue
        amounts = [t["amount"] for t in txns]
        median = sorted(amounts)[len(amounts) // 2]
        if median == 0:
            continue
        similar = [t for t in txns if abs(t["amount"] - median) <= median * 0.05]
        if len(similar) < 3:
            continue
        dates = sorted(datetime.strptime(t["date"], "%Y-%m-%d") for t in similar)
        intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        monthly = [iv for iv in intervals if 25 <= iv <= 35]
        if len(monthly) < 2:
            continue
        total = sum(t["amount"] for t in similar)
        result.append({
            "merchant": merchant,
            "monthly_avg_minor": int(total / len(similar)),
            "count": len(similar),
            "last_date": max(t["date"] for t in similar),
        })
    result.sort(key=lambda x: -x["monthly_avg_minor"])
    return result
