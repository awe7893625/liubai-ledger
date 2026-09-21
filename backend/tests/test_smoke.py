import sys
import os
import pathlib
import time
import json

# 每個 test 用獨立 DB，避免互相干擾


def _fresh_db(pathstr: str):
    for suffix in ["", "-wal", "-shm"]:
        p = pathstr if suffix == "" else pathstr + suffix
        if os.path.exists(p):
            os.remove(p)


def test_db_init():
    db_path = "/tmp/ledger_db_init.db"
    _fresh_db(db_path)
    os.environ["DATABASE_URL"] = "sqlite:///{}".format(db_path)
    from app.db import init_db, q
    init_db()
    tables = [
        r[0]
        for r in q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
         ]
    assert len(tables) >= 10, "expected >=10 tables, got {}: {}".format(
        len(tables), tables
    )
          # seed data
    accts = [r[0] for r in q("SELECT id FROM funding_accounts")]
    for expected in ["cash", "unknown"]:
        assert expected in accts, "no {} in funding_accounts: {}".format(expected, accts)
    cats = q("SELECT id FROM categories")
    assert len(cats) >= 10, "need >=10 cats, got {}".format(len(cats))
    assert q("SELECT COUNT(*) FROM budgets")[0][0] == 0
    del os.environ["DATABASE_URL"]


def test_server_boot():
    db_path = "/tmp/ledger_boot.db"
    _fresh_db(db_path)
    os.environ["DATABASE_URL"] = "sqlite:///{}".format(db_path)
    from app.main import app       # noqa: E402
    from app.db import init_db
    init_db()
    assert app.title == "Ledger by 留百工作室"
    paths = [getattr(r, "path", "") for r in app.routes]
    assert any(p.startswith("/api") for p in paths), "no /api routes: {}".format(
        paths
    )
        # T00 至少要有 /api/health / /api/ping / /api/schema / /api/db/tables
    for expected in ["/api/health", "/api/ping", "/api/schema"]:
        assert any(p == expected for p in paths), "missing {} in {}".format(
            expected, paths
        )
    del os.environ["DATABASE_URL"]


def test_api_reachable():
    db_path = "/tmp/ledger_api_test.db"
    _fresh_db(db_path)
    os.environ["DATABASE_URL"] = "sqlite:///{}".format(db_path)

    from app.main import app
    from app.db import init_db
    from fastapi.testclient import TestClient

    init_db()
    with TestClient(app) as c:
        r = c.get("/api/health")
        assert r.status_code == 200, "health returned {}: {}".format(
            r.status_code, r.text
        )
        data = r.json()
        assert data.get("status") == "ok", "unexpected health body: {}".format(data)

    del os.environ["DATABASE_URL"]