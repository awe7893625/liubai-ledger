"""Anomaly detection: flag transactions > 3x category median (90 days)."""
from __future__ import annotations

from datetime import date, timedelta

from app.db import q


def check_anomaly(category_id: str | None, amount_minor: int, ref_date: str) -> dict | None:
    if not category_id:
        return None
    d = date.fromisoformat(ref_date)
    start = (d - timedelta(days=90)).isoformat()
    rows = q(
        "SELECT -amount AS abs_amount FROM transactions "
        "WHERE user_id='local' AND status='confirmed' "
        "AND kind IN ('expense','unknown') AND amount<0 "
        "AND category_id=? AND date>=? AND date<?",
        category_id, start, ref_date,
    )
    if len(rows) < 3:
        return None
    values = sorted(int(r["abs_amount"]) for r in rows)
    median = values[len(values) // 2]
    if median <= 0:
        return None
    if abs(amount_minor) > median * 3:
        return {
            "category_id": category_id,
            "amount_minor": abs(amount_minor),
            "median_minor": median,
            "ratio": round(abs(amount_minor) / median, 1),
        }
    return None


def list_anomalies() -> list[dict]:
    today = date.today()
    start_90 = (today - timedelta(days=90)).isoformat()

    categories = q(
        "SELECT DISTINCT category_id FROM transactions "
        "WHERE user_id='local' AND status='confirmed' AND amount<0 "
        "AND kind IN ('expense','unknown') AND category_id IS NOT NULL "
        "AND date>=?",
        start_90,
    )

    anomalies = []
    for cat_row in categories:
        cat_id = cat_row["category_id"]
        amounts = q(
            "SELECT -amount AS abs_amount FROM transactions "
            "WHERE user_id='local' AND status='confirmed' "
            "AND kind IN ('expense','unknown') AND amount<0 "
            "AND category_id=? AND date>=?",
            cat_id, start_90,
        )
        if len(amounts) < 3:
            continue
        values = sorted(int(r["abs_amount"]) for r in amounts)
        median = values[len(values) // 2]
        if median <= 0:
            continue
        threshold = median * 3

        outliers = q(
            "SELECT id, date, merchant, merchant_normalized, -amount AS abs_amount "
            "FROM transactions WHERE user_id='local' AND status='confirmed' "
            "AND kind IN ('expense','unknown') AND amount<0 "
            "AND category_id=? AND date>=? AND (-amount)>?",
            cat_id, start_90, threshold,
        )
        for o in outliers:
            anomalies.append({
                "tx_id": o["id"],
                "date": o["date"],
                "merchant": o["merchant_normalized"] or o["merchant"],
                "amount_minor": int(o["abs_amount"]),
                "category_id": cat_id,
                "median_minor": median,
                "ratio": round(int(o["abs_amount"]) / median, 1),
            })

    anomalies.sort(key=lambda x: -x["ratio"])
    return anomalies
