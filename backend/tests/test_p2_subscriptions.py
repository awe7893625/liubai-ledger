"""P2 subscription detection + budget category usage tests."""
import os
import pytest


@pytest.fixture(autouse=True)
def _fresh_env(tmp_path):
    db = str(tmp_path / "test.db")
    os.environ["DATABASE_URL"] = f"sqlite:///{db}"
    from app.db import reset_conn, init_db
    reset_conn()
    init_db()
    yield
    reset_conn()
    del os.environ["DATABASE_URL"]


def _seed_recurring(c, merchant, amount_minor, dates):
    """Insert recurring transactions for subscription detection."""
    import hashlib
    for i, d in enumerate(dates):
        tid = f"tx-sub-{hashlib.sha1(f'{merchant}{i}'.encode()).hexdigest()[:8]}"
        c.execute(
            """INSERT OR IGNORE INTO transactions
                (id, user_id, funding_account_id, amount, currency, date, occurred_at,
                 merchant, merchant_normalized, source, status, kind, external_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (tid, "local", "cash", -amount_minor, "TWD", d, f"{d}T12:00:00",
             merchant, merchant, "capture", "confirmed", "expense", f"ext-{tid}"),
        )


class TestSubscriptions:
    def test_detects_monthly_recurring(self):
        from app.db import tx
        with tx() as c:
            _seed_recurring(c, "Netflix", 39000, [
                "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01",
            ])
        from app.services.subscriptions import detect_subscriptions
        subs = detect_subscriptions()
        assert len(subs) >= 1
        netflix = [s for s in subs if s["merchant"] == "Netflix"]
        assert len(netflix) == 1
        assert netflix[0]["count"] >= 3

    def test_ignores_irregular(self):
        from app.db import tx
        with tx() as c:
            _seed_recurring(c, "RandomShop", 10000, [
                "2026-01-01", "2026-03-15", "2026-08-20", "2026-09-01",
            ])
        from app.services.subscriptions import detect_subscriptions
        subs = detect_subscriptions()
        random = [s for s in subs if s["merchant"] == "RandomShop"]
        assert len(random) == 0

    def test_endpoint_returns_list(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.get("/api/subscriptions")
            assert r.status_code == 200
            assert isinstance(r.json(), list)


class TestBudgetCategoryUsage:
    def test_category_limits_include_spent(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            b = c.post("/api/budgets", json={
                "period_month": "2026-09",
                "total_limit_minor": 5000000,
            })
            assert b.status_code == 201
            bid = b.json()["id"]

            c.put(f"/api/budgets/{bid}/categories", json={
                "category_id": "c_food",
                "category_limit_minor": 1200000,
            })

            c.post("/api/transactions", json={
                "funding_account_id": "cash",
                "amount": -50000,
                "currency": "TWD",
                "date": "2026-09-05",
                "merchant": "Starbucks",
                "category_id": "c_food",
                "source": "manual",
                "status": "confirmed",
                "kind": "expense",
            })

            r = c.get(f"/api/budgets/{bid}/categories")
            assert r.status_code == 200
            data = r.json()
            food = [d for d in data if d["category_id"] == "c_food"]
            assert len(food) == 1
            assert food[0]["spent_minor"] == 50000
            assert food[0]["category_limit_minor"] == 1200000
            assert food[0]["pct_used"] is not None
