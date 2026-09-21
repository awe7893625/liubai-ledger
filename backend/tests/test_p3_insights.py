"""P3 insights, streak, and anomaly endpoint tests."""
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


def _shift_month(year, mo, delta):
    """Shift (year, mo) by delta months (can be negative)."""
    idx = year * 12 + (mo - 1) + delta
    return idx // 12, idx % 12 + 1


def _insert_tx(tid, d, amount=-10000, merchant="merchant-x", category=None):
    from app.db import tx
    with tx() as c:
        c.execute(
            """INSERT INTO transactions
                (id, user_id, funding_account_id, amount, currency, date,
                 occurred_at, category_id, merchant_normalized, source,
                 status, kind, external_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (tid, "local", "cash", amount, "TWD", d,
             f"{d}T12:00:00", category, merchant, "manual",
             "confirmed", "expense", f"ext-{tid}"),
        )


class TestInsights:
    def test_insights_returns_structure(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.get("/api/insights")
            assert r.status_code == 200
            data = r.json()
            assert "daily_avg_this_month" in data
            assert "category_trend" in data
            assert "top_merchants" in data
            assert "burn_rate" in data
            assert isinstance(data["category_trend"], dict)
            assert isinstance(data["top_merchants"], list)

    def test_top_merchants_scoped_to_current_month_only(self):
        from datetime import date, timedelta
        from app.main import app
        from fastapi.testclient import TestClient

        today = date.today()
        in_month_date = today.isoformat()
        # last day of the previous calendar month: guaranteed NOT in the
        # current month but well within a 90-day lookback.
        out_of_month_date = (date(today.year, today.month, 1) - timedelta(days=1)).isoformat()

        _insert_tx("tx-im-1", in_month_date, merchant="merchant-in-month")
        _insert_tx("tx-oom-1", out_of_month_date, merchant="merchant-out-of-month")

        with TestClient(app) as c:
            r = c.get("/api/insights")
            assert r.status_code == 200
            merchants = {m["merchant"] for m in r.json()["top_merchants"]}
            assert "merchant-in-month" in merchants
            assert "merchant-out-of-month" not in merchants

    def test_insights_month_param_past_month(self):
        from calendar import monthrange
        from datetime import date
        from app.main import app
        from fastapi.testclient import TestClient

        today = date.today()
        py, pm = _shift_month(today.year, today.month, -2)
        past_month = f"{py:04d}-{pm:02d}"
        days = monthrange(py, pm)[1]
        past_date = f"{past_month}-{days:02d}"

        _insert_tx("tx-past-1", past_date, amount=-5000, merchant="merchant-past")

        with TestClient(app) as c:
            r = c.get(f"/api/insights?month={past_month}")
            assert r.status_code == 200
            data = r.json()
            assert data["window"]["month"] == past_month
            assert data["window"]["start"] == f"{past_month}-01"
            assert data["window"]["end"] == f"{past_month}-{days:02d}"
            found = [m for m in data["top_merchants"] if m["merchant"] == "merchant-past"]
            assert len(found) == 1
            assert found[0]["total_minor"] == 5000

    def test_insights_invalid_month_rejected(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.get("/api/insights?month=2026-13")
            assert 400 <= r.status_code < 500
            r = c.get("/api/insights?month=abc")
            assert 400 <= r.status_code < 500

    def test_insights_no_month_param_unchanged_window(self):
        from calendar import monthrange
        from datetime import date
        from app.main import app
        from fastapi.testclient import TestClient

        today = date.today()
        expected_month = f"{today.year:04d}-{today.month:02d}"
        days = monthrange(today.year, today.month)[1]

        with TestClient(app) as c:
            r = c.get("/api/insights")
            assert r.status_code == 200
            data = r.json()
            assert data["window"]["month"] == expected_month
            assert data["window"]["start"] == f"{expected_month}-01"
            assert data["window"]["end"] == f"{expected_month}-{days:02d}"


    def test_category_totals_follow_transaction_reclassification(self):
        from datetime import date
        from app.main import app
        from fastapi.testclient import TestClient

        month = date.today().strftime("%Y-%m")
        day = f"{month}-01"
        _insert_tx("tx-reclass-1", day, amount=-12345, merchant="Far Eastern", category="c_food")

        with TestClient(app) as c:
            before = c.get(f"/api/insights?month={month}")
            assert before.status_code == 200
            before_data = before.json()
            assert before_data["total_spent_minor"] == 12345
            before_categories = {row["category_id"]: row["total_minor"] for row in before_data["category_totals"]}
            assert before_categories["c_food"] == 12345

            patch = c.patch("/api/transactions/tx-reclass-1", json={"category_id": "c_shopping"})
            assert patch.status_code == 200, patch.text
            assert patch.json()["category_id"] == "c_shopping"

            after = c.get(f"/api/insights?month={month}")
            assert after.status_code == 200
            after_data = after.json()
            assert after_data["total_spent_minor"] == 12345
            after_categories = {row["category_id"]: row["total_minor"] for row in after_data["category_totals"]}
            assert after_categories.get("c_food", 0) == 0
            assert after_categories["c_shopping"] == 12345
            assert sum(row["total_minor"] for row in after_data["category_totals"]) == after_data["total_spent_minor"]

    def test_pending_and_transfer_rows_do_not_pollute_analytics(self):
        from datetime import date
        from app.db import tx
        from app.main import app
        from fastapi.testclient import TestClient

        month = date.today().strftime("%Y-%m")
        day = f"{month}-02"
        with tx() as conn:
            conn.execute(
                """INSERT INTO transactions
                   (id,user_id,funding_account_id,amount,currency,date,occurred_at,category_id,
                    merchant_normalized,source,status,kind,external_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("tx-pending-x", "local", "cash", -50000, "TWD", day, f"{day}T12:00:00",
                 "c_food", "pending-x", "manual", "pending", "expense", "ext-pending-x"),
            )
            conn.execute(
                """INSERT INTO transactions
                   (id,user_id,funding_account_id,amount,currency,date,occurred_at,category_id,
                    merchant_normalized,source,status,kind,external_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("tx-transfer-x", "local", "cash", -70000, "TWD", day, f"{day}T13:00:00",
                 "c_food", "transfer-x", "manual", "confirmed", "transfer", "ext-transfer-x"),
            )

        with TestClient(app) as c:
            data = c.get(f"/api/insights?month={month}").json()
            assert data["total_spent_minor"] == 0
            assert data["category_totals"] == []
            assert data["account_totals"] == []
            assert data["top_merchants"] == []


class TestStreak:
    def test_streak_empty(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.get("/api/streak")
            assert r.status_code == 200
            data = r.json()
            assert data["current_streak"] == 0
            assert data["longest_streak"] == 0

    def test_streak_with_data(self):
        import hashlib
        from app.db import tx
        from datetime import date, timedelta
        today = date.today()
        with tx() as c:
            for i in range(5):
                d = (today - timedelta(days=i)).isoformat()
                tid = f"tx-streak-{hashlib.sha1(d.encode()).hexdigest()[:8]}"
                c.execute(
                    """INSERT INTO transactions
                        (id, user_id, funding_account_id, amount, currency, date,
                         occurred_at, source, status, kind, external_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (tid, "local", "cash", -10000, "TWD", d,
                     f"{d}T12:00:00", "manual", "confirmed", "expense", f"ext-{tid}"),
                )
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.get("/api/streak")
            assert r.status_code == 200
            data = r.json()
            assert data["current_streak"] == 5
            assert data["longest_streak"] >= 5


class TestAnomalies:
    def test_anomalies_endpoint(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.get("/api/anomalies")
            assert r.status_code == 200
            assert isinstance(r.json(), list)

    def test_anomaly_detection(self):
        import hashlib
        from app.db import tx
        from datetime import date, timedelta
        today = date.today()
        with tx() as c:
            for i in range(5):
                d = (today - timedelta(days=10 + i)).isoformat()
                tid = f"tx-anom-{hashlib.sha1(f'normal{i}'.encode()).hexdigest()[:8]}"
                c.execute(
                    """INSERT INTO transactions
                        (id, user_id, funding_account_id, amount, currency, date,
                         occurred_at, category_id, source, status, kind, external_id)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (tid, "local", "cash", -10000, "TWD", d,
                     f"{d}T12:00:00", "c_food", "manual", "confirmed",
                     "expense", f"ext-{tid}"),
                )
            # Insert an outlier (10x the normal amount)
            d = (today - timedelta(days=1)).isoformat()
            c.execute(
                """INSERT INTO transactions
                    (id, user_id, funding_account_id, amount, currency, date,
                     occurred_at, category_id, source, status, kind, external_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("tx-anom-outlier", "local", "cash", -100000, "TWD", d,
                 f"{d}T12:00:00", "c_food", "manual", "confirmed",
                 "expense", "ext-outlier"),
            )

        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.get("/api/anomalies")
            assert r.status_code == 200
            data = r.json()
            assert len(data) >= 1
            outlier = [a for a in data if a["tx_id"] == "tx-anom-outlier"]
            assert len(outlier) == 1
            assert outlier[0]["ratio"] >= 3.0
