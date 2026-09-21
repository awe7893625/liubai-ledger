"""T70 Inbox Resolution — resolve/dismiss API tests."""
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
    raw.execute(
        "INSERT INTO email_events (id,user_id,funding_account_id,source,subject,"
        "received_at,content_hash,event_type,parsed_json) "
        "VALUES (?, 'local','card-demo','email-demo','消費通知','2026-09-01T10:00:00',?, 'payment',?)",
        (f"ev-{uuid.uuid4().hex[:6]}", uuid.uuid4().hex,
         '{"amount_minor":-12000,"date":"2026-09-01","merchant":"超商"}'))
    raw.commit()
    raw.close()
    return TestClient(app)


def _first_event_id(client):
    rows = client.get("/api/inbox").json()
    return rows[0]["id"]


def test_resolve_creates_confirmed_transaction():
    client = _setup()
    eid = _first_event_id(client)
    r = client.post(f"/api/inbox/{eid}/resolve", json={"category_id": "c_food"})
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["amount"] == -12000
    assert data["status"] == "confirmed"
    assert data["category_name"] == "餐飲"
    assert data["account_nickname"] == "Demo Visa"
    assert data["inbox_item_id"] == eid
    # inbox marked resolved
    ev = client.get(f"/api/inbox/{eid}").json()
    assert ev["inbox_status"] == "resolved"


def test_resolve_body_overrides_parsed():
    client = _setup()
    eid = _first_event_id(client)
    r = client.post(f"/api/inbox/{eid}/resolve",
                    json={"amount_minor": -999, "date": "2026-09-02",
                          "notes": "手動改"})
    assert r.status_code == 201
    assert r.json()["amount"] == -999
    assert r.json()["date"] == "2026-09-02"


def test_resolve_missing_amount_422():
    client = _setup()
    eid = _first_event_id(client)
    # overwrite parsed_json to be empty so no fallback amount
    import app.db as db
    db.q_exec("UPDATE email_events SET parsed_json='{}' WHERE id=?", eid)
    r = client.post(f"/api/inbox/{eid}/resolve", json={})
    assert r.status_code == 422


def test_resolve_unknown_event_404():
    client = _setup()
    r = client.post("/api/inbox/nope/resolve", json={"amount_minor": -100})
    assert r.status_code == 404


def test_resolve_twice_409():
    client = _setup()
    eid = _first_event_id(client)
    assert client.post(f"/api/inbox/{eid}/resolve", json={}).status_code == 201
    assert client.post(f"/api/inbox/{eid}/resolve", json={}).status_code == 409


def test_unknown_account_404():
    client = _setup()
    eid = _first_event_id(client)
    r = client.post(f"/api/inbox/{eid}/resolve",
                    json={"funding_account_id": "ghost"})
    assert r.status_code == 404


def test_dismiss_then_status():
    client = _setup()
    eid = _first_event_id(client)
    r = client.post(f"/api/inbox/{eid}/dismiss")
    assert r.status_code == 200
    assert r.json()["inbox_status"] == "dismissed"
    ev = client.get(f"/api/inbox/{eid}").json()
    assert ev["inbox_status"] == "dismissed"


def test_dismiss_unknown_404():
    client = _setup()
    assert client.post("/api/inbox/nope/dismiss").status_code == 404


def test_resolve_refund_event_lands_as_refund():
    """A refund email must keep its kind, or it stops discounting the budget."""
    client = _setup()
    from app import db

    db.q_exec(
        "INSERT INTO email_events (id,user_id,funding_account_id,source,subject,"
        "received_at,content_hash,event_type,parsed_json) "
        "VALUES ('ev-refund','local','card-demo','email-demo','退款通知',"
        "'2026-09-02T10:00:00','hash-refund','refund',?)",
        '{"amount_minor":3000,"date":"2026-09-02","merchant":"超商"}',
    )
    r = client.post("/api/inbox/ev-refund/resolve", json={"category_id": "c_food"})
    assert r.status_code == 201, r.text
    row = db.q1("SELECT kind FROM transactions WHERE id=?", r.json()["id"])
    assert dict(row)["kind"] == "refund"
