"""overview router — T30-Dashboard Overview, powered by Phase 2 budget engines."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.db import q, q1, q_scalar
from app.services import budget as eng

router = APIRouter(prefix="/api/overview", tags=["overview"])


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, "today must be ISO YYYY-MM-DD")


@router.get("")
def overview(month: str | None = None, today: str | None = None):
    m = month or eng.current_month()
    today_value = _parse_date(today)
    month_start, month_end, days_total = eng.month_bounds(m)

    # income / expense
    income = q_scalar(
          "SELECT COALESCE(SUM(amount),0) FROM transactions "
          "WHERE user_id='local' AND status='confirmed' AND amount>0 "
          "AND date>=? AND date<=?",
         month_start,
         month_end,
         ) or 0
    expense = q_scalar(
          "SELECT COALESCE(SUM(-amount),0) FROM transactions "
          "WHERE user_id='local' AND status='confirmed' AND amount<0 "
          "AND kind IN ('expense','unknown') "
          "AND date>=? AND date<=?",
         month_start,
         month_end,
         ) or 0

    # budget engines (T21/T22/T23)
    summary = eng.budget_summary(m, today_value)
    sts = eng.safe_to_spend(m, today_value)
    fc = eng.forecast(m, today_value)
    pace = eng.pace_series(m, today_value)

    total_limit = summary["total_limit_minor"]
    spent = summary["net_spent_minor"]
    remaining = summary["remaining_minor"]
    pct = summary["utilization_pct"]
    days_elapsed = summary["days_elapsed"]
    forecast = fc["projected_end_minor"]
    safe_to_spend = sts["safe_to_spend_minor"]

    # top categories
    top_rows = q(
          "SELECT c.id, c.name, c.slug, "
          "COALESCE(SUM(-t.amount),0) AS spent_minor "
          "FROM categories c "
          "LEFT JOIN transactions t ON t.category_id=c.id "
          "  AND t.user_id='local' AND t.status='confirmed' AND t.amount<0 "
          "  AND t.kind IN ('expense','unknown') "
          "  AND t.date>=? AND t.date<=? "
          "GROUP BY c.id, c.name, c.slug",
         month_start,
         month_end,
         )
    top_categories = []
    for r in top_rows:
        row = dict(r)
        row["spent_minor"] = int(row["spent_minor"])
        row["budget_minor"] = 0
        row["remaining_minor"] = 0 - row["spent_minor"]
        row["pct_used"] = 0.0
        row["over_budget"] = False
        top_categories.append(row)
    top_categories.sort(key=lambda x: -x["spent_minor"])

    # recent transactions
    recent = q(
          "SELECT t.*, a.nickname AS account_nickname, c.name AS category_name "
          "FROM transactions t "
          "LEFT JOIN funding_accounts a ON a.id=t.funding_account_id "
          "LEFT JOIN categories c ON c.id=t.category_id "
          "WHERE t.user_id='local' AND t.date>=? AND t.date<=? "
          "ORDER BY t.date DESC, t.occurred_at DESC LIMIT 20",
         month_start,
         month_end,
         )

    counts = q(
          "SELECT "
          " COUNT(*) AS tx_count, "
          " SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed, "
          " SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending "
          "FROM transactions WHERE user_id='local' AND date>=? AND date<=?",
         month_start,
         month_end,
         )
    cc = dict(counts[0]) if counts else {}

    return {
        "month": m,
        "period_start": month_start,
        "period_end": month_end,
        "income_minor": int(income),
        "expense_minor": int(expense),
        "net_minor": int(income - expense),
        "budget_limit_minor": total_limit,
        "budget_spent_minor": spent,
        "budget_remaining_minor": remaining,
        "budget_pct_used": pct,
        "days_elapsed": days_elapsed,
        "days_total": days_total,
        "days_remaining": summary["days_remaining"],
        "pace": pace,
        "forecast_end_minor": forecast,
        "safe_to_spend_minor": safe_to_spend,
        "safe_to_spend_today_minor": sts["safe_to_spend_today_minor"],
        "reserved_minor": sts["reserved_minor"],
        "is_over_budget": summary["is_over_budget"],
        "top_categories": top_categories,
        "recent_transactions": [dict(r) for r in recent],
        "transactions_count": cc.get("tx_count", 0) or 0,
        "confirmed_count": cc.get("confirmed", 0) or 0,
        "pending_count": cc.get("pending", 0) or 0,
     }


def _current_month() -> str:
    return eng.current_month()
