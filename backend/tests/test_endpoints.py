"""Test real /api endpoints with FastAPI TestClient — no subprocess."""
import os
import pathlib


def _fresh_db(pathstr: str):
    for suffix in ["", "-wal", "-shm"]:
        p = pathstr if suffix == "" else pathstr + suffix
        if os.path.exists(p):
            os.remove(p)


def test_endpoints():
    db_path = "/tmp/ledger_realtest.db"
    _fresh_db(db_path)
    os.environ["DATABASE_URL"] = "sqlite:///{}".format(db_path)

    from app.main import app
    from app.db import init_db
    from fastapi.testclient import TestClient

    init_db()
    with TestClient(app) as c:
        r = c.get("/api/health")
        assert r.status_code == 200, "health: {}".format(r.text)
        assert r.json()["status"] == "ok"

        r = c.get("/api/ping")
        assert r.status_code == 200, "ping: {}".format(r.text)
        assert r.json()["pong"] == "ok"

        r = c.get("/api/schema")
        assert r.status_code == 200, "schema: {}".format(r.text)
        assert r.json()["version"] == "1.0.0"

        r = c.get("/api/db/tables")
        assert r.status_code == 200, "db/tables: {}".format(r.text)
        tables = r.json()
        assert "funding_accounts" in tables
        assert "transactions" in tables
        assert "budgets" in tables

         # accounts
        r = c.get("/api/accounts")
        assert r.status_code == 200, "accounts: {}".format(r.text)
        accounts = r.json()
        assert len(accounts) >= 2, "expected >=2 generic accounts, got {}".format(len(accounts))

         # transactions
        r = c.get("/api/transactions")
        assert r.status_code == 200, "transactions: {}".format(r.text)

         # budgets
        r = c.get("/api/budgets")
        assert r.status_code == 200, "budgets: {}".format(r.text)

         # overview
        r = c.get("/api/overview")
        assert r.status_code == 200, "overview: {}".format(r.text)

         # categories
        r = c.get("/api/categories")
        assert r.status_code == 200, "categories: {}".format(r.text)

    del os.environ["DATABASE_URL"]