"""Same-origin self-hosted entry serves the app without turning unknown APIs into HTML."""
from fastapi.testclient import TestClient
import pytest

@pytest.fixture
def web(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///" + str(tmp_path / "web.db"))
    from app.db import reset_conn
    reset_conn()
    from app.web import create_web_app
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>Demo Ledger</title><main>APP</main>")
    (dist / "asset.css").write_text("body { color: black; }")
    with TestClient(create_web_app(dist)) as client:
        yield client
    reset_conn()

def test_app_routes_and_assets(web):
    assert web.get("/").status_code == 200
    assert "Demo Ledger" in web.get("/dashboard").text
    assert "Demo Ledger" in web.get("/ledger").text
    assert web.get("/asset.css").status_code == 200

def test_api_not_spa_fallback(web):
    assert web.get("/api/health").json()["status"] == "ok"
    assert web.get("/api/not-a-route").status_code == 404
    assert "APP" not in web.get("/api/not-a-route").text

def test_missing_assets_not_spa(web):
    assert web.get("/missing.js").status_code == 404
    assert web.get("/does-not-exist.png").status_code == 404

def test_build_required(tmp_path):
    from app.web import create_web_app
    with pytest.raises(RuntimeError, match="Build frontend"):
        create_web_app(tmp_path)
