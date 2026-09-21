"""insights router — spending analytics."""
from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from app.db import q

router = APIRouter(prefix="/api/insights", tags=["insights"])


def _valid_month(m: str) -> bool:
    if len(m) != 7 or m[4] != "-":
        return False
    try:
        y, mo = int(m[:4]), int(m[5:7])
    except ValueError:
        return False
    return 1 <= mo <= 12 and 2000 <= y <= 2100


@router.get("")
def get_insights(month: str | None = None):
    today = date.today()

    if month is not None:
        if not _valid_month(month):
            raise HTTPException(422, "month must be YYYY-MM")
        year, mo = int(month[:4]), int(month[5:7])
    else:
        year, mo = today.year, today.month
        month = f"{year:04d}-{mo:02d}"

    _, days_in_month = monthrange(year, mo)
    start = f"{month}-01"
    end = f"{month}-{days_in_month:02d}"

    total_spent = int(
        q(
            "SELECT COALESCE(SUM(-amount), 0) FROM transactions "
            "WHERE user_id='local' AND status='confirmed' AND amount<0 "
            "AND kind IN ('expense','unknown') AND date>=? AND date<=?",
            start, end,
        )[0][0] or 0
    )
    if year == today.year and mo == today.month:
        days_elapsed = (today - date(year, mo, 1)).days + 1
    else:
        # a non-current target month has no "so far" — treat it as fully
        # elapsed so daily_avg/burn_rate aren't skewed by today's date.
        days_elapsed = days_in_month
    daily_avg = int(total_spent / max(1, days_elapsed))

    months = []
    d = date(year, mo, 1)
    for _ in range(3):
        months.append(f"{d.year:04d}-{d.month:02d}")
        d = d.replace(day=1) - timedelta(days=1)

    # Canonical category/account totals. Every analytics surface must use the same
    # inclusion rule as budget/overview: confirmed expense rows only. Keeping this
    # logic server-side prevents the mobile pie chart and desktop summary from drifting.
    category_rows = q(
        "SELECT COALESCE(t.category_id, '__uncategorized__') AS category_id, "
        "COALESCE(c.name, '未分類') AS name, COALESCE(SUM(-t.amount), 0) AS total, COUNT(*) AS count "
        "FROM transactions t LEFT JOIN categories c ON c.id=t.category_id "
        "WHERE t.user_id='local' AND t.status='confirmed' AND t.amount<0 "
        "AND t.kind IN ('expense','unknown') AND t.date>=? AND t.date<=? "
        "GROUP BY COALESCE(t.category_id, '__uncategorized__'), COALESCE(c.name, '未分類') "
        "ORDER BY total DESC",
        start, end,
    )
    account_rows = q(
        "SELECT t.funding_account_id AS account_id, COALESCE(a.nickname, '未指定支付方式') AS name, "
        "COALESCE(SUM(-t.amount), 0) AS total, COUNT(*) AS count "
        "FROM transactions t LEFT JOIN funding_accounts a ON a.id=t.funding_account_id "
        "WHERE t.user_id='local' AND t.status='confirmed' AND t.amount<0 "
        "AND t.kind IN ('expense','unknown') AND t.date>=? AND t.date<=? "
        "GROUP BY t.funding_account_id, COALESCE(a.nickname, '未指定支付方式') "
        "ORDER BY total DESC",
        start, end,
    )

    category_trend = {}
    for m in months:
        rows = q(
            "SELECT COALESCE(category_id, '__uncategorized__') AS category_id, "
            "COALESCE(SUM(-amount), 0) AS total "
            "FROM transactions WHERE user_id='local' AND status='confirmed' "
            "AND amount<0 AND kind IN ('expense','unknown') "
            "AND date LIKE ? GROUP BY COALESCE(category_id, '__uncategorized__')",
            f"{m}-%",
        )
        category_trend[m] = {r["category_id"]: int(r["total"]) for r in rows}

    # merchant_normalized already separates Uber from UberEats. Grouping by category here
    # would split one merchant into multiple Top-N rows after a user recategorises a purchase.
    top_merchants = q(
        "SELECT merchant_normalized, COALESCE(SUM(-amount), 0) AS total, COUNT(*) AS count "
        "FROM transactions WHERE user_id='local' AND status='confirmed' "
        "AND amount<0 AND kind IN ('expense','unknown') "
        "AND date>=? AND date<=? AND merchant_normalized IS NOT NULL "
        "AND TRIM(merchant_normalized)<>'' "
        "GROUP BY merchant_normalized ORDER BY total DESC LIMIT 8",
        start, end,
    )

    from app.services.budget import get_budget_row
    budget_row = get_budget_row(month)
    budget_configured = bool(budget_row and budget_row["total_limit_minor"] > 0)
    if budget_configured:
        expected_by_now = budget_row["total_limit_minor"] * days_elapsed / days_in_month
        burn_rate = round(total_spent / expected_by_now, 2) if expected_by_now > 0 else 0.0
    else:
        burn_rate = None

    return {
        "daily_avg_this_month": daily_avg,
        "total_spent_minor": total_spent,
        "category_totals": [
            {
                "category_id": r["category_id"],
                "name": r["name"],
                "total_minor": int(r["total"]),
                "count": int(r["count"]),
            }
            for r in category_rows
        ],
        "account_totals": [
            {
                "account_id": r["account_id"],
                "name": r["name"],
                "total_minor": int(r["total"]),
                "count": int(r["count"]),
            }
            for r in account_rows
        ],
        "category_trend": category_trend,
        "top_merchants": [
            {
                "merchant": r["merchant_normalized"],
                "total_minor": int(r["total"]),
                "count": int(r["count"]),
            }
            for r in top_merchants
        ],
        "burn_rate": burn_rate,
        "budget_configured": budget_configured,
        "window": {"month": month, "start": start, "end": end},
    }
