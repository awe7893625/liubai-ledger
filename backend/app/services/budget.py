"""budget engine — Phase 2 core (T21 summary / T22 safe-to-spend / T23 forecast).

All money values are minor units (int). Expense = negative amount in
transactions table; engines return positive minor-unit figures.
"""
from __future__ import annotations

from calendar import monthrange
from datetime import date

from app.db import q, q1


# ---------------------------------------------------------------- helpers

def current_month() -> str:
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}"


def month_bounds(month: str) -> tuple[str, str, int]:
    """Return (start_iso, end_iso, days_in_month) for YYYY-MM."""
    year, mo = int(month[:4]), int(month[5:7])
    days = monthrange(year, mo)[1]
    return f"{month}-01", f"{month}-{days:02d}", days


def get_budget_row(month: str):
    return q1(
        "SELECT * FROM budgets WHERE user_id='local' AND period_month=?", month
    )


EXPENSE_KINDS_SQL = "kind IN ('expense','unknown')"


def expense_where(user: str = 'local') -> str:
    return ("user_id=? AND status='confirmed' AND amount<0 "
            "AND kind IN ('expense','unknown')")


def spent_in_month(month: str) -> int:
    """Positive minor units spent (expenses) in month, confirmed only."""
    start, end, _ = month_bounds(month)
    v = q(
        f"SELECT COALESCE(SUM(-amount),0) FROM transactions WHERE {expense_where()} "
        "AND date>=? AND date<=?",
        'local',
        start,
        end,
    )
    return int(v[0][0] or 0)


def refunded_in_month(month: str) -> int:
    """Positive minor units refunded in month, confirmed only.

    Only kind='refund' counts. Income (salary, transfers in) is positive too but
    must never discount spending — see migration 0004.
    """
    start, end, _ = month_bounds(month)
    v = q(
        "SELECT COALESCE(SUM(amount),0) FROM transactions "
        "WHERE user_id='local' AND status='confirmed' AND amount>0 "
        "AND kind='refund' "
        "AND date>=? AND date<=?",
        start,
        end,
    )
    return int(v[0][0] or 0)


def category_spent(month: str, category_id: str) -> int:
    start, end, _ = month_bounds(month)
    v = q(
        f"SELECT COALESCE(SUM(-amount),0) FROM transactions WHERE {expense_where()} "
        "AND category_id=? AND date>=? AND date<=?",
        'local',
        category_id,
        start,
        end,
    )
    return int(v[0][0] or 0)


def reserved_pending(month: str) -> list[dict]:
    """Pending reserved expenses relevant to this month.

    A reservation counts when: still pending AND (no expected_date OR
    expected_date falls inside this month).
    """
    start, end, _ = month_bounds(month)
    rows = q(
        "SELECT * FROM reserved_expenses "
        "WHERE user_id='local' AND status='pending' "
        "AND (expected_date IS NULL OR (expected_date>=? AND expected_date<=?)) "
        "ORDER BY expected_date IS NULL, expected_date",
        start,
        end,
    )
    return [dict(r) for r in rows]


def reserved_total(month: str) -> int:
    return sum(int(r["amount_minor"]) for r in reserved_pending(month))


def days_elapsed_in_month(month: str, today: date | None = None) -> int:
    """Days elapsed including today, clamped to the month."""
    today = today or date.today()
    start, end, days = month_bounds(month)
    first = date(int(month[:4]), int(month[5:7]), 1)
    last = date(int(month[:4]), int(month[5:7]), days)
    if today < first:
        return 0
    if today > last:
        return days
    return (today - first).days + 1


def pace_series(month: str, today: date | None = None) -> list[dict]:
    """Return actual cumulative spend and ideal budget pace for each day."""
    today = today or date.today()
    start, end, days_total = month_bounds(month)
    row = get_budget_row(month)
    budget_limit = int(row["total_limit_minor"]) if row else 0

    daily_rows = q(
        "SELECT date, "
        f"COALESCE(SUM(CASE WHEN amount<0 AND {EXPENSE_KINDS_SQL} THEN -amount ELSE 0 END),0) AS spent_minor, "
        "COALESCE(SUM(CASE WHEN amount>0 AND kind='refund' THEN amount ELSE 0 END),0) ""AS refunded_minor "
        "FROM transactions "
        "WHERE user_id='local' AND status='confirmed' "
        "AND date>=? AND date<=? "
        "GROUP BY date",
        start,
        end,
    )
    daily = {
        r["date"]: (int(r["spent_minor"] or 0), int(r["refunded_minor"] or 0))
        for r in daily_rows
    }

    days_elapsed = days_elapsed_in_month(month, today)
    spent = 0
    refunded = 0
    series = []
    for day in range(1, days_total + 1):
        day_date = date(int(month[:4]), int(month[5:7]), day).isoformat()
        actual: int | None = None
        if day <= days_elapsed:
            day_spent, day_refunded = daily.get(day_date, (0, 0))
            spent += day_spent
            refunded += day_refunded
            actual = max(0, spent - refunded)
        series.append(
            {
                "day": day,
                "date": day_date,
                "actual_minor": actual,
                "pace_minor": round(budget_limit * day / days_total),
            }
        )
    return series


# ------------------------------------------------------- T21 summary

def budget_summary(month: str, today: date | None = None) -> dict:
    """T21 Summary engine: spent / remaining / utilization / days remaining."""
    today = today or date.today()
    row = get_budget_row(month)
    total_limit = int(row["total_limit_minor"]) if row else 0
    safety_buffer = int(row["safety_buffer_minor"]) if row else 0

    spent = spent_in_month(month)
    refunded = refunded_in_month(month)
    # refunds offset spending but never inflate budget below zero spend
    net_spent = max(0, spent - refunded)

    effective_limit = max(0, total_limit - safety_buffer)
    remaining = effective_limit - net_spent
    utilization = round(net_spent / effective_limit * 100, 1) if effective_limit else 0.0

    start, end, days_total = month_bounds(month)
    days_elapsed = days_elapsed_in_month(month, today)
    days_remaining = max(0, days_total - days_elapsed)

    return {
        "month": month,
        "total_limit_minor": total_limit,
        "safety_buffer_minor": safety_buffer,
        "effective_limit_minor": effective_limit,
        "spent_minor": spent,
        "refunded_minor": refunded,
        "net_spent_minor": net_spent,
        "remaining_minor": remaining,
        "utilization_pct": utilization,
        "is_over_budget": net_spent > effective_limit if effective_limit else False,
        "days_elapsed": days_elapsed,
        "days_total": days_total,
        "days_remaining": days_remaining,
    }


def category_breakdown(month: str) -> list[dict]:
    """Per-category spend vs category budget (budget_categories table)."""
    row = get_budget_row(month)
    budget_id = row["id"] if row else None
    spent_rows = q(
        "SELECT category_id, COALESCE(SUM(-amount),0) AS spent_minor "
        "FROM transactions WHERE user_id='local' AND status='confirmed' "
        "AND amount<0 AND date LIKE ? AND category_id IS NOT NULL "
        "GROUP BY category_id",
        f"{month}-%",
    )
    spent_map = {r["category_id"]: int(r["spent_minor"]) for r in spent_rows}

    uncategorized_minor = int(
        q(
            "SELECT COALESCE(SUM(-amount),0) FROM transactions "
            "WHERE user_id='local' AND status='confirmed' "
            "AND amount<0 AND date LIKE ? AND category_id IS NULL",
            f"{month}-%",
        )[0][0]
        or 0
    )

    limits: dict[str, int] = {}
    if budget_id:
        for r in q(
            "SELECT category_id, category_limit_minor FROM budget_categories WHERE budget_id=?",
            budget_id,
        ):
            limits[r["category_id"]] = int(r["category_limit_minor"])

    out = []
    for cat in q("SELECT id, name, slug FROM categories WHERE user_id='local' ORDER BY sort_order"):
        cid = cat["id"]
        s = spent_map.get(cid, 0)
        lim = limits.get(cid, 0)
        out.append(
            {
                "category_id": cid,
                "name": cat["name"],
                "slug": cat["slug"],
                "spent_minor": s,
                "limit_minor": lim,
                "remaining_minor": lim - s if lim else None,
                "pct_used": round(s / lim * 100, 1) if lim else None,
                "over_budget": s > lim if lim else False,
            }
        )

    if uncategorized_minor > 0:
        out.append(
            {
                "category_id": None,
                "name": "未分類",
                "slug": None,
                "spent_minor": uncategorized_minor,
                "limit_minor": 0,
                "remaining_minor": None,
                "pct_used": None,
                "over_budget": False,
            }
        )

    out.sort(key=lambda x: -x["spent_minor"])
    return out


# -------------------------------------------------- T22 safe-to-spend

def safe_to_spend(month: str, today: date | None = None) -> dict:
    """T22: money still safe to spend today.

    safe = effective_limit - net_spent - reserved_pending_total, floored at 0.
    """
    today = today or date.today()
    s = budget_summary(month, today)
    reserved = reserved_total(month)
    effective = s["effective_limit_minor"]
    safe = max(0, effective - s["net_spent_minor"] - reserved)
    return {
        "month": month,
        "effective_limit_minor": effective,
        "net_spent_minor": s["net_spent_minor"],
        "reserved_minor": reserved,
        "reserved_count": len(reserved_pending(month)),
        "safe_to_spend_minor": safe,
        # what today alone may absorb — the whole-month figure read as a daily
        # allowance is how people overspend on day one
        "safe_to_spend_today_minor": safe // max(1, s["days_remaining"] + 1),
        "remaining_minor": s["remaining_minor"],
        "days_remaining": s["days_remaining"],
    }


# ------------------------------------------------------ T23 forecast

def forecast(month: str, today: date | None = None) -> dict:
    """T23: end-of-month projection.

    Variable daily rate = net_spent / days_elapsed (0-division guarded).
    Projected end spend = net_spent + rate * days_remaining, plus any
    reserved recurring amounts still pending (they WILL be spent).
    """
    today = today or date.today()
    s = budget_summary(month, today)
    days_elapsed = s["days_elapsed"]
    days_remaining = s["days_remaining"]

    rate = 0.0
    if days_elapsed > 0:
        rate = s["net_spent_minor"] / days_elapsed

    projected = s["net_spent_minor"] + rate * days_remaining

    # reserved recurring: pending reservations expected later in the month
    # are already part of committed spend; add them to the projection
    res_rows = reserved_pending(month)
    future_reserved = sum(
        int(r["amount_minor"])
        for r in res_rows
        if r["expected_date"] is not None
    )
    projected += future_reserved

    effective = s["effective_limit_minor"]
    projected = int(round(projected))
    return {
        "month": month,
        "daily_rate_minor": round(rate, 1),
        "days_elapsed": days_elapsed,
        "days_remaining": days_remaining,
        "projected_end_minor": projected,
        "effective_limit_minor": effective,
        "projected_over_budget": projected > effective if effective else False,
        "projected_remaining_minor": effective - projected,
        "future_reserved_minor": future_reserved,
    }


def full_snapshot(month: str | None = None, today: date | None = None) -> dict:
    """One response feeding dashboard widgets (T30 contract)."""
    month = month or current_month()
    today = today or date.today()
    return {
        "summary": budget_summary(month, today),
        "categories": category_breakdown(month),
        "safe_to_spend": safe_to_spend(month, today),
        "forecast": forecast(month, today),
        "reserved": reserved_pending(month),
    }
