"""Release checks for one-port private hosting, safe setup, and shortcut templates."""
import importlib.util
import os
from pathlib import Path
import plistlib
import pytest

ROOT = Path(__file__).resolve().parents[2]

@pytest.fixture
def web_client(tmp_path, monkeypatch):
    from app import db, web
    monkeypatch.setenv("DATABASE_URL", "sqlite:///" + str(tmp_path / "web.db"))
    db.reset_conn()
    public = tmp_path / "web"
    public.mkdir()
    (public / "index.html").write_text("<h1>DEMO SPA</h1>")
    (public / "asset.js").write_text("console.log('demo');")
    (tmp_path / "outside.txt").write_text("DO NOT SERVE")
    monkeypatch.setattr(web, "WEB_ROOT", public)
    from fastapi.testclient import TestClient
    with TestClient(web.app) as client:
        yield client
    db.reset_conn()

def test_web_api_health_is_not_spa(web_client):
    r = web_client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

@pytest.mark.parametrize("path", ["/", "/ledger", "/settings", "/setup"])
def test_spa_routes(web_client, path):
    r = web_client.get(path)
    assert r.status_code == 200 and "DEMO SPA" in r.text

def test_unknown_api_and_traversal_are_not_spa(web_client):
    assert web_client.get("/api/does-not-exist").status_code == 404
    r = web_client.get("/%2e%2e/outside.txt")
    assert r.status_code == 404 and "DO NOT SERVE" not in r.text
    assert web_client.get("/asset.js").status_code == 200

def test_setup_env_is_private_and_non_overwriting(tmp_path):
    spec = importlib.util.spec_from_file_location("setup_env", ROOT / "scripts/setup_env.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.create_settings(tmp_path)
    target = tmp_path / ".env"
    before = target.read_bytes()
    assert target.stat().st_mode & 0o777 == 0o600
    token = next(x for x in before.decode().splitlines() if x.startswith("LEDGER_INGEST_TOKEN=")).split("=", 1)[1]
    assert len(token) >= 40
    assert not mod.create_settings(tmp_path)
    assert target.read_bytes() == before

@pytest.mark.parametrize("name", ["Ledger-Manual", "Ledger-ApplePay"])
def test_shortcut_template_has_explicit_personal_configuration(name):
    d = plistlib.loads((ROOT / "shortcuts/source" / (name + ".shortcut")).read_bytes())
    assert len(d["WFWorkflowImportQuestions"]) == 2
    a = d["WFWorkflowActions"]
    assert a[1]["WFWorkflowActionParameters"]["WFTextActionText"] == "https://YOUR-LEDGER.invalid/api/wallet"
    assert a[2]["WFWorkflowActionParameters"]["WFTextActionText"] == "REPLACE_WITH_YOUR_INGEST_TOKEN"
    post = [x for x in a if x["WFWorkflowActionIdentifier"].endswith("downloadurl")][0]["WFWorkflowActionParameters"]
    assert post["WFHTTPMethod"] == "POST"
    keys = {item["WFKey"]["Value"]["string"] for item in post["WFJSONValues"]["Value"]["WFDictionaryFieldValueItems"]}
    assert keys == {"amount", "merchant", "card", "occurred_at", "payment_method", "time_source"}
    assert not any(x["WFWorkflowActionIdentifier"].endswith("getcurrentlocation") for x in a)
    public = ROOT / "frontend/public/shortcuts" / (name + ".shortcut")
    assert public.exists() and public.stat().st_size > 10000
