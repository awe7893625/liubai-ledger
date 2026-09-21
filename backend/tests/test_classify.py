"""P1 classify service + wallet integration tests."""
import os
import pytest


@pytest.fixture(autouse=True)
def _fresh_env(tmp_path):
    db = str(tmp_path / "test.db")
    os.environ["DATABASE_URL"] = f"sqlite:///{db}"
    os.environ["LEDGER_OLLAMA_BASE"] = "http://127.0.0.1:19999"
    from app.db import reset_conn, init_db
    reset_conn()
    init_db()
    yield
    reset_conn()
    del os.environ["DATABASE_URL"]
    del os.environ["LEDGER_OLLAMA_BASE"]


class TestClassifyService:
    def test_rule_match_keyword(self):
        from app.services.classify import classify
        cat, conf, method = classify("coffee shop", "", 150)
        assert cat == "c_food"
        assert conf == 0.95
        assert method == "rule"

    def test_rule_match_description_fallback(self):
        from app.services.classify import classify
        cat, conf, method = classify("UNKNOWN-SHOP", "taxi ride home", 250)
        assert cat == "c_transport"
        assert method == "rule"

    def test_merchant_table_fallback(self):
        from app.services.classify import classify
        from app.db import q_exec
        q_exec(
            "INSERT OR IGNORE INTO merchants (raw_name, normalized_name, default_category) "
            "VALUES (?, ?, ?)",
            "TESTMERCHANT99", "TestMerchant", "c_education",
        )
        cat, conf, method = classify("TESTMERCHANT99 branch", "", 300)
        assert cat == "c_education"
        assert conf == 0.9
        assert method == "merchant"

    def test_none_when_no_match(self):
        from app.services.classify import classify
        cat, conf, method = classify("XYZRANDOMSHOP", "", 500)
        assert cat is None
        assert conf is None
        assert method == "none"

    def test_rule_priority_over_merchant(self):
        from app.services.classify import classify
        cat, conf, method = classify("coffee shop", "", 55)
        assert method == "rule"
        assert cat == "c_food"
        assert conf == 0.95


class TestWalletClassifyIntegration:
    def test_known_merchant_confirmed(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.post("/api/wallet", json={
                "amount": 55, "merchant": "coffee shop", "card": "Demo Visa",
                "occurred_at": "2026-09-07T10:00:00",
            })
            assert r.status_code == 201
            from app.db import q
            tx = q("SELECT status, notes FROM transactions WHERE id=?",
                   r.json()["tx_id"])
            assert tx[0]["status"] == "confirmed"
            assert "classify=rule" in tx[0]["notes"]

    def test_unknown_merchant_pending(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = c.post("/api/wallet", json={
                "amount": 500, "merchant": "XYZRANDOMSHOP", "card": "Demo Visa",
                "occurred_at": "2026-09-07T12:00:00",
            })
            assert r.status_code == 201
            from app.db import q
            tx = q("SELECT status, notes, category_id FROM transactions WHERE id=?",
                   r.json()["tx_id"])
            assert tx[0]["status"] == "pending"
            assert tx[0]["category_id"] is None
            assert "classify=none" in tx[0]["notes"]
