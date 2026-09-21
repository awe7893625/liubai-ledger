"""T10 Ledger Core — transactions CRUD test."""
import os
import uuid
import sqlite3
from fastapi.testclient import TestClient
from app.main import app
from app.db import init_db


def _setup():
    db_file = f"/tmp/ledger_{uuid.uuid4().hex[:8]}.db"
    if os.path.exists(db_file):
        os.remove(db_file)
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file}"
    os.makedirs(os.path.dirname(db_file), exist_ok=True)
    init_db()
    raw = sqlite3.connect(db_file)
    raw.row_factory = sqlite3.Row
    raw.execute("INSERT OR IGNORE INTO users (id, display_name) VALUES ('local', 'user')")
    raw.execute(
        "INSERT OR IGNORE INTO funding_accounts "
        "(id,user_id,type,issuer,nickname,last4,currency) "
        "VALUES ('card-demo','local','credit_card','DEMO','Demo Visa','0001','TWD')")
    raw.execute(
        "INSERT OR IGNORE INTO categories (id,user_id,name,slug) "
        "VALUES ('c_food','local','餐飲','food')")
    raw.commit()
    raw.close()


def test_transactions_crud():
    _setup()

    ts = uuid.uuid4().hex[:6]
    body = {
        "funding_account_id": "card-demo",
        "amount": -15000,
        "currency": "TWD",
        "date": "2026-08-25",
        "description": f"Test meal {ts}",
        "merchant": "7-Eleven",
        "merchant_normalized": "7eleven",
        "category_id": "c_food",
        "source": "manual",
        "status": "pending",
        "is_recurring": 0,
        "notes": None,
    }
    client = TestClient(app)

    r = client.post("/api/transactions", json=body)
    assert r.status_code == 201, f"create: {r.text}"
    tx_id = r.json()["id"]
    assert tx_id.startswith("tx-")
    assert r.json()["amount"] == -15000

    r = client.get(f"/api/transactions/{tx_id}")
    assert r.status_code == 200
    assert r.json()["amount"] == -15000
    assert r.json()["category_name"]

    r = client.get("/api/transactions")
    assert r.status_code == 200
    assert len(r.json()) >= 1

    r = client.patch(f"/api/transactions/{tx_id}", json={"status": "confirmed"})
    assert r.status_code == 200, f"patch: {r.text}"
    assert r.json()["status"] == "confirmed"

    # Explicit null clears a classification; omitted fields remain unchanged.
    r = client.patch(f"/api/transactions/{tx_id}", json={"category_id": None})
    assert r.status_code == 200, f"clear category: {r.text}"
    assert r.json()["category_id"] is None
    assert r.json()["category_name"] is None

    # Flipping the sign in the editor must keep analytics `kind` semantics in sync.
    r = client.patch(f"/api/transactions/{tx_id}", json={"amount": 5000})
    assert r.status_code == 200, f"flip amount: {r.text}"
    assert r.json()["amount"] == 5000
    assert r.json()["kind"] == "income"

    r = client.patch(f"/api/transactions/{tx_id}", json={"status": "not-a-status"})
    assert r.status_code == 422

    r = client.delete(f"/api/transactions/{tx_id}")
    assert r.status_code == 204

    r = client.get(f"/api/transactions/{tx_id}")
    assert r.status_code == 404
