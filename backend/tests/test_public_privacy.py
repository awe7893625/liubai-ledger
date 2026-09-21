"""Open-source privacy/security defaults."""
import os
import pytest

@pytest.fixture()
def client(tmp_path):
    os.environ["DATABASE_URL"] = "sqlite:///" + str(tmp_path / "privacy.db")
    os.environ.pop("LEDGER_INGEST_TOKEN", None)
    os.environ.pop("LEDGER_STORE_LOCATION", None)
    from app.db import reset_conn, init_db
    reset_conn()
    init_db()
    from app.main import app
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c
    reset_conn()
    os.environ.pop("DATABASE_URL", None)
    os.environ.pop("LEDGER_INGEST_TOKEN", None)
    os.environ.pop("LEDGER_STORE_LOCATION", None)

def test_ingest_token_enforced_when_configured(client):
    os.environ["LEDGER_INGEST_TOKEN"] = "unit-test-secret"
    body = {"amount": 88, "merchant": "coffee shop", "card": "Demo Card"}
    assert client.post("/api/wallet", json=body).status_code == 401
    assert client.post(
        "/api/wallet", json=body, headers={"X-Ledger-Token": "wrong"}
    ).status_code == 401
    ok = client.post(
        "/api/wallet", json=body, headers={"X-Ledger-Token": "unit-test-secret"}
    )
    assert ok.status_code == 201

def test_location_and_raw_card_not_persisted_by_default(client):
    body = {
        "amount": 120,
        "merchant": "coffee shop",
        "card": "My Private Card Label",
        "latitude": 25.033,
        "longitude": 121.5654,
        "location_name": "Private Place",
    }
    r = client.post("/api/wallet", json=body)
    assert r.status_code == 201
    from app.db import q
    row = q("SELECT notes FROM transactions WHERE id=?", r.json()["tx_id"])[0]
    notes = row["notes"] or ""
    assert "25.033" not in notes
    assert "121.5654" not in notes
    assert "Private Place" not in notes
    assert "My Private Card Label" not in notes
