"""POST /api/transactions — automated sources without category_id get auto-classified
(rule → merchant → LLM), manual stays untouched. Guards the M4-deployed classify block
(cls_method must be defined on every path; a NameError here was a real 500 on M4)."""
import os
import uuid

os.environ["LEDGER_OLLAMA_BASE"] = "http://127.0.0.1:9"  # unreachable: LLM stage must fail closed, not hang


def _client():
    os.environ["DATABASE_URL"] = f"sqlite:////tmp/ledger_autocls_{uuid.uuid4().hex[:8]}.db"
    from app.main import app
    from app.db import init_db
    from fastapi.testclient import TestClient
    init_db()
    return TestClient(app)


def test_capture_without_category_is_auto_classified():
    with _client() as c:
        body = {"funding_account_id": "cash", "amount": -15000, "currency": "TWD",
                "date": "2026-09-10", "description": "coffee shop", "merchant": "coffee shop",
                "merchant_normalized": "coffee shop", "source": "capture", "status": "confirmed",
                "external_id": "autocls-" + uuid.uuid4().hex[:8], "notes": "m4relay"}
        r = c.post("/api/transactions", json=body)
        assert r.status_code == 201, r.text
        t = r.json()
        assert t["category_id"], t
        assert "classify=" in (t.get("notes") or ""), t

        # manual entries are never auto-classified
        body2 = dict(body, source="manual", external_id=None, status="pending",
                     merchant="coffee shop", amount=-15100)
        r2 = c.post("/api/transactions", json=body2)
        assert r2.status_code == 201, r2.text
        assert r2.json()["category_id"] is None
        assert "classify=" not in (r2.json().get("notes") or "")
