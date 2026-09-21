"""Pace-series tests for the dashboard overview."""
from __future__ import annotations

import os
import sqlite3
import uuid
from datetime import date

from fastapi.testclient import TestClient

MONTH = "2026-09"
LIMIT = 3_000_000


def _setup() -> TestClient:
    db_file = f"/tmp/ledger_pace_{uuid.uuid4().hex[:8]}.db"
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
        "INSERT INTO budgets "
        "(id,user_id,period_month,total_limit_minor,safety_buffer_minor) "
        f"VALUES ('budget-pace','local','{MONTH}',{LIMIT},0)"
    )
    raw.commit()
    raw.close()
    return TestClient(__import__("app.main", fromlist=["app"]).app)


def _add_tx(
    client: TestClient,
    amount: int,
    day: int,
    status: str = "confirmed",
    kind: str | None = None,
) -> None:
    response = client.post(
        "/api/transactions",
        json={
            "funding_account_id": "card-demo",
            "amount": amount,
            "currency": "TWD",
            "date": f"{MONTH}-{day:02d}",
            "description": f"pace-{amount}-{day}",
            "category_id": "c_food",
            "source": "manual",
            "status": status,
            **({"kind": kind} if kind else {}),
        },
    )
    assert response.status_code == 201, response.text


def test_overview_pace_zero_transactions_until_today() -> None:
    client = _setup()
    response = client.get(
        "/api/overview",
        params={"month": MONTH, "today": date(2026, 9, 10).isoformat()},
    )

    assert response.status_code == 200, response.text
    pace = response.json()["pace"]
    assert len(pace) == 30
    assert [point["day"] for point in pace] == list(range(1, 31))
    assert [point["date"] for point in pace] == [
        f"{MONTH}-{day:02d}" for day in range(1, 31)
    ]
    assert all(point["actual_minor"] == 0 for point in pace[:10])
    assert all(point["actual_minor"] is None for point in pace[10:])
    assert [point["pace_minor"] for point in pace] == [
        round(LIMIT * day / 30) for day in range(1, 31)
    ]


def test_overview_pace_accumulates_confirmed_net_spend() -> None:
    client = _setup()
    _add_tx(client, -100_000, 2)
    _add_tx(client, -250_000, 5)
    _add_tx(client, 50_000, 6, kind="refund")
    _add_tx(client, -1_000_000, 7, status="pending")

    pace = client.get(
        "/api/overview",
        params={"month": MONTH, "today": date(2026, 9, 10).isoformat()},
    ).json()["pace"]

    assert [pace[day - 1]["actual_minor"] for day in range(1, 7)] == [
        0,
        100_000,
        100_000,
        100_000,
        350_000,
        300_000,
    ]
    assert all(point["actual_minor"] is None for point in pace[10:])


def test_overview_pace_past_month_is_fully_observed() -> None:
    client = _setup()
    pace = client.get(
        "/api/overview",
        params={"month": "2026-08", "today": date(2026, 9, 10).isoformat()},
    ).json()["pace"]

    assert len(pace) == 31
    assert all(point["actual_minor"] == 0 for point in pace)
