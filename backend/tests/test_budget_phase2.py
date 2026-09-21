"""Phase 2 Budget Core tests — T20 CRUD / T21 summary / T22 safe-to-spend /
T23 forecast, including the 4 required boundary cases:
  1. month with zero transactions
  2. month with refund
  3. month over budget
  4. month final day
"""
import os
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

MONTH = "2026-09"
LIMIT = 3_000_000          # $30,000.00
BUFFER = 500_000           # $5,000.00
EFFECTIVE = LIMIT - BUFFER


def _setup():
    db_file = f"/tmp/ledger_p2_{uuid.uuid4().hex[:8]}.db"
    for suffix in ["", "-wal", "-shm"]:
        p = db_file + suffix
        if os.path.exists(p):
            os.remove(p)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file}"
    os.makedirs(os.path.dirname(db_file), exist_ok=True)
    from app.db import init_db
    init_db()
    raw = sqlite3.connect(db_file)
    raw.row_factory = sqlite3.Row
    raw.execute("INSERT OR IGNORE INTO users (id, display_name) VALUES ('local', 'user')")
    raw.execute(
        "INSERT OR IGNORE INTO funding_accounts "
        "(id,user_id,type,issuer,nickname,last4,currency) "
        "VALUES ('card-demo','local','credit_card','DEMO','card-demo','0001','TWD')")
    raw.execute(
        "INSERT OR IGNORE INTO categories (id,user_id,name,slug) "
        "VALUES ('c_food','local','food','food')")
    raw.execute(
        "INSERT INTO budgets (id,user_id,period_month,total_limit_minor,safety_buffer_minor) "
        f"VALUES ('budget-p2','local','{MONTH}',{LIMIT},{BUFFER})")
    raw.commit()
    raw.close()
    return TestClient(__import__("app.main", fromlist=["app"]).app)


def _add_tx(client, amount, day, status="confirmed", category="c_food", kind=None):
    r = client.post(
        "/api/transactions",
        json={
            "funding_account_id": "card-demo",
            "amount": amount,
            "currency": "TWD",
            "date": f"{MONTH}-{day:02d}",
            "description": f"t{amount}_{day}",
            "category_id": category,
            "source": "manual",
            "status": status,
            **({"kind": kind} if kind else {}),
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ------------------------------------------------------- T20 CRUD

def test_budget_crud_and_validation():
    c = _setup()

    # create new month
    r = c.post("/api/budgets", json={
        "period_month": "2026-10", "total_limit_minor": 4_000_000,
        "safety_buffer_minor": 300_000})
    assert r.status_code == 201, r.text
    bid = r.json()["id"]

    # duplicate month rejected
    r = c.post("/api/budgets", json={
        "period_month": "2026-10", "total_limit_minor": 1})
    assert r.status_code == 409

    # invalid month format / negative / buffer>total
    assert c.post("/api/budgets", json={
        "period_month": "2026-13", "total_limit_minor": 1}).status_code == 422
    assert c.post("/api/budgets", json={
        "period_month": "2026-11", "total_limit_minor": -1}).status_code == 422
    assert c.post("/api/budgets", json={
        "period_month": "2026-11", "total_limit_minor": 100,
        "safety_buffer_minor": 200}).status_code == 422

    # get with live figures
    r = c.get(f"/api/budgets?month=2026-10")
    assert r.status_code == 200
    assert r.json()["total_limit_minor"] == 4_000_000

    # patch
    r = c.patch(f"/api/budgets/{bid}", json={"total_limit_minor": 5_000_000})
    assert r.status_code == 200, r.text
    assert r.json()["total_limit_minor"] == 5_000_000
    # buffer > new total rejected
    r = c.patch(f"/api/budgets/{bid}", json={"safety_buffer_minor": 9_000_000})
    assert r.status_code == 422
    # 404
    assert c.patch("/api/budgets/nope", json={"total_limit_minor": 1}).status_code == 404

    # category limit upsert
    r = c.put(f"/api/budgets/{bid}/categories",
              json={"category_id": "c_food", "category_limit_minor": 800_000})
    assert r.status_code == 201, r.text
    # idempotent upsert updates
    r = c.put(f"/api/budgets/{bid}/categories",
              json={"category_id": "c_food", "category_limit_minor": 900_000})
    assert r.status_code == 201
    rows = c.get(f"/api/budgets/{bid}/categories").json()
    assert len(rows) == 1 and rows[0]["category_limit_minor"] == 900_000


# ------------------------------------------- T21 zero-transactions month

def test_summary_zero_transactions_month():
    c = _setup()
    r = c.get(f"/api/budgets/summary?month={MONTH}")
    assert r.status_code == 200
    d = r.json()
    assert d["spent_minor"] == 0
    assert d["net_spent_minor"] == 0
    assert d["remaining_minor"] == EFFECTIVE
    assert d["utilization_pct"] == 0.0
    assert d["is_over_budget"] is False
    # engine-level days_elapsed=0 case must not blow up rate math
    fc = c.get(f"/api/budgets/forecast?month={MONTH}").json()
    assert fc["daily_rate_minor"] == 0.0
    assert fc["projected_end_minor"] == 0


# ------------------------------------------------------ T21 refund month

def test_summary_refund_offsets_spending():
    c = _setup()
    _add_tx(c, -1_000_000, 5)          # spend $10,000
    _add_tx(c, 200_000, 10, kind="refund")   # refund $2,000
    d = c.get(f"/api/budgets/summary?month={MONTH}").json()
    assert d["spent_minor"] == 1_000_000
    assert d["refunded_minor"] == 200_000
    assert d["net_spent_minor"] == 800_000
    assert d["remaining_minor"] == EFFECTIVE - 800_000
    # refund never pushes net spend negative
    _add_tx(c, 5_000_000, 12, kind="refund")  # huge refund
    d = c.get(f"/api/budgets/summary?month={MONTH}").json()
    assert d["net_spent_minor"] == 0
    assert d["remaining_minor"] == EFFECTIVE


# -------------------------------------------------- T21 over-budget month

def test_summary_over_budget_month():
    c = _setup()
    _add_tx(c, -EFFECTIVE, 3)                      # exactly at limit
    d = c.get(f"/api/budgets/summary?month={MONTH}").json()
    assert d["is_over_budget"] is False
    assert d["remaining_minor"] == 0
    _add_tx(c, -1, 4)                              # $0.01 over
    d = c.get(f"/api/budgets/summary?month={MONTH}").json()
    assert d["is_over_budget"] is True
    assert d["remaining_minor"] == -1


# ----------------------------------------------------- T22 safe-to-spend

def test_safe_to_spend_reserved_and_edges():
    c = _setup()
    # reserved pending reduces safe-to-spend
    r = c.post("/api/budgets/reserved",
               json={"name": "rent", "amount_minor": 1_000_000,
                     "expected_date": f"{MONTH}-01"})
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    d = c.get(f"/api/budgets/safe-to-spend?month={MONTH}").json()
    assert d["reserved_minor"] == 1_000_000
    assert d["safe_to_spend_minor"] == EFFECTIVE - 1_000_000

    # reservation with expected_date outside the month does NOT count
    c.post("/api/budgets/reserved",
           json={"name": "next-mo", "amount_minor": 500_000,
                 "expected_date": "2026-10-05"})
    d = c.get(f"/api/budgets/safe-to-spend?month={MONTH}").json()
    assert d["reserved_minor"] == 1_000_000

    # no-date reservation counts for every month
    c.post("/api/budgets/reserved",
           json={"name": "undated", "amount_minor": 100_000})
    d = c.get(f"/api/budgets/safe-to-spend?month={MONTH}").json()
    assert d["reserved_minor"] == 1_100_000

    # spend + reserved exceeding effective limit floors safe at 0
    _add_tx(c, -EFFECTIVE, 2)
    d = c.get(f"/api/budgets/safe-to-spend?month={MONTH}").json()
    assert d["safe_to_spend_minor"] == 0
    assert d["net_spent_minor"] == EFFECTIVE

    # cancelling a reservation releases it
    r = c.patch(f"/api/budgets/reserved/{rid}", json={"status": "cancelled"})
    assert r.status_code == 200
    d = c.get(f"/api/budgets/safe-to-spend?month={MONTH}").json()
    assert d["reserved_minor"] == 100_000


# --------------------------------------------------------- T23 forecast

def test_forecast_variable_rate_and_reserved():
    c = _setup()
    from datetime import date
    from app.services import budget as eng

    # mid-month: day 10 of 30, spent 900_000 → rate 90_000/day
    today = date(2026, 9, 10)
    _add_tx(c, -300_000, 1)
    _add_tx(c, -600_000, 9)
    d = c.get(f"/api/budgets/forecast",
              params={"month": MONTH, "today": today.isoformat()}).json()
    assert d["days_elapsed"] == 10
    assert d["days_remaining"] == 20
    # projected = 900_000 + 90_000*20 = 2_700_000 (no reserved yet)
    assert d["projected_end_minor"] == 2_700_000
    assert d["projected_over_budget"] is True  # 2.7M > effective 2.5M

    # future-dated reserved recurring adds to projection
    c.post("/api/budgets/reserved",
           json={"name": "internet", "amount_minor": 100_000,
                 "expected_date": f"{MONTH}-25"})
    d = c.get(f"/api/budgets/forecast",
              params={"month": MONTH, "today": today.isoformat()}).json()
    assert d["future_reserved_minor"] == 100_000
    assert d["projected_end_minor"] == 2_800_000
    assert d["projected_remaining_minor"] == EFFECTIVE - 2_800_000

    # final-day edge: days_remaining = 0, projected == actual spend + reserved
    today = date(2026, 9, 30)
    f = eng.forecast(MONTH, today)
    assert f["days_remaining"] == 0
    assert f["days_elapsed"] == 30
    assert f["projected_end_minor"] == 1_000_000  # 900k spent + 100k reserved
    # rate uses full-month elapsed


# ------------------------------------------- T21 month final-day boundary

def test_month_final_day_boundary():
    from datetime import date
    from app.services import budget as eng
    c = _setup()
    _add_tx(c, -1_500_000, 30)   # spend on the last day itself
    s = eng.budget_summary(MONTH, date(2026, 9, 30))
    assert s["days_elapsed"] == 30
    assert s["days_total"] == 30
    assert s["days_remaining"] == 0
    assert s["net_spent_minor"] == 1_500_000
    # Feb leap-year handling via monthrange: 2028-02 has 29 days
    st, en, days = eng.month_bounds("2028-02")
    assert days == 29 and en == "2028-02-29"
    st, en, days = eng.month_bounds("2026-02")
    assert days == 28
    # after-month clamp: days_elapsed caps at days_total
    assert eng.days_elapsed_in_month(MONTH, date(2026, 10, 15)) == 30
    assert eng.days_elapsed_in_month(MONTH, date(2026, 8, 15)) == 0


# ---------------------------------------------- reserved CRUD + overview

def test_reserved_crud_and_overview_wiring():
    c = _setup()
    r = c.post("/api/budgets/reserved",
               json={"name": "bill", "amount_minor": 300_000,
                     "expected_date": f"{MONTH}-15"})
    rid = r.json()["id"]
    # validation
    assert c.post("/api/budgets/reserved",
                  json={"name": "x", "amount_minor": 0}).status_code == 422
    assert c.post("/api/budgets/reserved",
                  json={"name": "x", "amount_minor": 1,
                        "category_id": "ghost"}).status_code == 404
    # patch + list + delete
    assert c.patch(f"/api/budgets/reserved/{rid}",
                   json={"amount_minor": 350_000}).json()["amount_minor"] == 350_000
    assert any(x["id"] == rid for x in c.get("/api/budgets/reserved").json())
    assert c.delete(f"/api/budgets/reserved/{rid}").status_code == 204
    assert c.delete(f"/api/budgets/reserved/{rid}").status_code == 404

    # overview carries engine fields (pinned today for deterministic days math)
    from datetime import date as _date
    today = _date(2026, 9, 20)
    _add_tx(c, -1_000_000, 8)
    o = c.get("/api/overview",
              params={"month": MONTH, "today": today.isoformat()}).json()
    assert o["budget_spent_minor"] == 1_000_000
    assert o["safe_to_spend_minor"] == EFFECTIVE - 1_000_000
    assert o["reserved_minor"] == 0
    assert "days_remaining" in o and "forecast_end_minor" in o


# ------------------------------------------ BLOCKER 2: income is not a refund

def test_income_does_not_offset_spending():
    """Salary lands as income, so the month keeps its spending (was zeroed)."""
    c = _setup()
    _add_tx(c, -1_000_000, 5)
    _add_tx(c, 5_000_000, 10)          # salary, kind defaults to income
    d = c.get(f"/api/budgets/summary?month={MONTH}").json()
    assert d["spent_minor"] == 1_000_000
    assert d["refunded_minor"] == 0
    assert d["net_spent_minor"] == 1_000_000
    assert d["remaining_minor"] == EFFECTIVE - 1_000_000


# --------------------------------- P0-3: uncategorized row in breakdown

def test_category_breakdown_uncategorized_row():
    from app.services import budget as eng
    c = _setup()
    _add_tx(c, -400_000, 5, category=None)
    _add_tx(c, -100_000, 6)  # categorized under c_food
    rows = eng.category_breakdown(MONTH)
    uncategorized = [r for r in rows if r["category_id"] is None]
    assert len(uncategorized) == 1
    u = uncategorized[0]
    assert u["name"] == "未分類"
    assert u["spent_minor"] == 400_000
    assert u["limit_minor"] == 0
    assert u["remaining_minor"] is None
    assert u["pct_used"] is None
    assert u["over_budget"] is False


# -------------------------------------------- P0-3 sibling: transfer excluded

def test_transfer_kind_excluded_from_spend():
    from app.services import budget as eng
    c = _setup()
    _add_tx(c, -500_000, 5, kind="transfer")
    _add_tx(c, -200_000, 6)
    assert eng.spent_in_month(MONTH) == 200_000
    d = c.get(f"/api/budgets/summary?month={MONTH}").json()
    assert d["spent_minor"] == 200_000


# ------------------------------------------- P0-6: ai_ask excludes pending

def test_ai_ask_month_stats_excludes_pending():
    from app.routers import ai_ask
    c = _setup()
    _add_tx(c, -300_000, 5, status="confirmed")
    _add_tx(c, -900_000, 6, status="pending")
    stats = ai_ask._month_stats(MONTH)
    assert stats["expense"] == 3000.0
    assert stats["n"] == 1
