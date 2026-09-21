"""Regression tests for the /api/overview money-math blockers.

B1 — month queries had no upper bound (`date>=month_start` only), so querying a
     past month folded every later month into it.
B3 — top_categories used SUM() without GROUP BY, so SQLite returned a single
     arbitrary category carrying the grand total.
"""
from __future__ import annotations

import os
import sqlite3
import uuid

from fastapi.testclient import TestClient

MONTH = "2026-09"
NEXT_MONTH = "2026-10"
LIMIT = 3_000_000


def _setup() -> TestClient:
    db_file = f"/tmp/ledger_blockers_{uuid.uuid4().hex[:8]}.db"
    for suffix in ["", "-wal", "-shm"]:
        path = db_file + suffix
        if os.path.exists(path):
            os.remove(path)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file}"

    from app.db import init_db

    init_db()
    raw = sqlite3.connect(db_file)
    raw.execute(
        "INSERT OR IGNORE INTO users (id, display_name) VALUES ('local', 'user')"
    )
    raw.execute(
        "INSERT OR IGNORE INTO funding_accounts "
        "(id,user_id,type,issuer,nickname,last4,currency) "
        "VALUES ('card-demo','local','credit_card','DEMO','card-demo','0001','TWD')"
    )
    raw.execute(
        "INSERT OR IGNORE INTO categories (id,user_id,name,slug) "
        "VALUES ('c_food','local','food','food')"
    )
    raw.execute(
        "INSERT OR IGNORE INTO categories (id,user_id,name,slug) "
        "VALUES ('c_transport','local','transport','transport')"
    )
    raw.execute(
        "INSERT INTO budgets "
        "(id,user_id,period_month,total_limit_minor,safety_buffer_minor) "
        f"VALUES ('budget-blockers','local','{MONTH}',{LIMIT},0)"
    )
    raw.commit()
    raw.close()
    return TestClient(__import__("app.main", fromlist=["app"]).app)


def _add_tx(
    client: TestClient,
    amount: int,
    day_iso: str,
    category_id: str = "c_food",
) -> None:
    response = client.post(
        "/api/transactions",
        json={
            "funding_account_id": "card-demo",
            "amount": amount,
            "currency": "TWD",
            "date": day_iso,
            "description": f"blockers-{amount}-{day_iso}",
            "category_id": category_id,
            "source": "manual",
            "status": "confirmed",
        },
    )
    assert response.status_code in (200, 201), response.text


def test_month_query_has_upper_bound():
    """A later month's transactions must not leak into an earlier month."""
    client = _setup()
    _add_tx(client, -100_000, f"{MONTH}-10")
    _add_tx(client, 500_000, f"{MONTH}-05")
    # next month — must be excluded from the MONTH view entirely
    _add_tx(client, -900_000, f"{NEXT_MONTH}-03")
    _add_tx(client, 700_000, f"{NEXT_MONTH}-04")

    data = client.get(f"/api/overview?month={MONTH}").json()

    assert data["expense_minor"] == 100_000
    assert data["income_minor"] == 500_000
    assert data["transactions_count"] == 2
    assert data["confirmed_count"] == 2
    assert all(
        t["date"].startswith(MONTH) for t in data["recent_transactions"]
    ), [t["date"] for t in data["recent_transactions"]]


def test_top_categories_are_grouped_per_category():
    """Each category reports its own spend, not the grand total on one row."""
    client = _setup()
    _add_tx(client, -300_000, f"{MONTH}-06", category_id="c_food")
    _add_tx(client, -200_000, f"{MONTH}-07", category_id="c_food")
    _add_tx(client, -150_000, f"{MONTH}-08", category_id="c_transport")
    # later month must not inflate any category
    _add_tx(client, -800_000, f"{NEXT_MONTH}-02", category_id="c_food")

    data = client.get(f"/api/overview?month={MONTH}").json()
    by_slug = {c["slug"]: c["spent_minor"] for c in data["top_categories"]}

    assert by_slug["food"] == 500_000
    assert by_slug["transport"] == 150_000
    # no row may carry the grand total of every category
    assert all(v <= 500_000 for v in by_slug.values()), by_slug


def test_safe_to_spend_today_is_the_daily_slice():
    """The month figure shown as a daily allowance is how day one overspends."""
    client = _setup()
    _add_tx(client, -500_000, f"{MONTH}-02")

    data = client.get(f"/api/overview?month={MONTH}&today={MONTH}-21").json()

    days_remaining = data["days_remaining"]
    assert days_remaining == 9          # days_remaining excludes today
    assert data["safe_to_spend_today_minor"] == data["safe_to_spend_minor"] // 10   # today + 9 left
    assert data["safe_to_spend_today_minor"] < data["safe_to_spend_minor"]
