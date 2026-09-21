"""Merchant normalization + generic category-rule regression tests."""
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

def _post_wallet(client, merchant, amount=100, occurred_at="2026-09-05T12:00:00"):
    return client.post("/api/wallet", json={
        "amount": amount,
        "merchant": merchant,
        "card": "Demo Card",
        "occurred_at": occurred_at,
    })

def _seed_mapping(raw_name, normalized_name, category):
    from app.db import q_exec
    q_exec(
        "INSERT INTO merchants (raw_name, normalized_name, default_category) VALUES (?,?,?)",
        raw_name, normalized_name, category,
    )
class TestMerchantNormalization:
    def test_user_defined_mapping(self):
        _seed_mapping("DEMO MART", "Demo Market", "c_shopping")
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = _post_wallet(c, "DEMO MART branch")
            assert r.status_code == 201
            from app.db import q
            row = q("SELECT merchant_normalized FROM transactions WHERE id=?", r.json()["tx_id"])
            assert row[0]["merchant_normalized"] == "Demo Market"

    def test_unknown_merchant_passthrough(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = _post_wallet(c, "RANDOM-UNKNOWN-SHOP")
            assert r.status_code == 201
            from app.db import q
            row = q("SELECT merchant_normalized FROM transactions WHERE id=?", r.json()["tx_id"])
            assert row[0]["merchant_normalized"] == "RANDOM-UNKNOWN-SHOP"

    def test_ingest_ledger_written(self):
        from app.main import app
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            r = _post_wallet(c, "coffee shop")
            assert r.status_code == 201
            from app.db import q
            logs = q("SELECT source, tx_id FROM ingest_log WHERE tx_id=?", r.json()["tx_id"])
            assert len(logs) == 1
            assert logs[0]["source"] == "capture"
class TestCategoryRegression:
    def test_generic_food_and_transport_rules(self):
        from app.utils.categorize import guess_category
        assert guess_category("coffee shop") == "c_food"
        assert guess_category("taxi ride") == "c_transport"

    def test_yaml_contains_same_categories_as_builtin(self):
        from app.utils.categorize import _load_yaml_rules, CATEGORY_RULES
        yaml_rules = _load_yaml_rules()
        assert yaml_rules is not None
        assert {cat for cat, _ in yaml_rules} == {cat for cat, _ in CATEGORY_RULES}

    def test_yaml_fallback_on_missing_file(self):
        from app.utils import categorize
        orig = categorize._YAML_PATH
        categorize._YAML_PATH = orig.parent / "nonexistent.yaml"
        categorize._ACTIVE_RULES = None
        try:
            assert categorize.guess_category("coffee shop") == "c_food"
            assert categorize.guess_category("taxi ride") == "c_transport"
        finally:
            categorize._YAML_PATH = orig
            categorize._ACTIVE_RULES = None
