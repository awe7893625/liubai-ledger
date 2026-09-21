"""One-origin private hosting. Preserve explicit SPA routes and never expose files outside dist."""
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse
from app.main import create_app

WEB_ROOT = Path(__file__).resolve().parents[2] / "frontend" / "dist"
SPA_ROUTES = {"", "dashboard", "ledger", "budget", "capture", "map", "settings", "setup", "assistant", "reflect"}

def create_web_app(dist=None):
    if dist is not None and not (Path(dist) / "index.html").is_file():
        raise RuntimeError("Build frontend first: cd frontend && npm ci && npm run build")
    app = create_app()
    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "API route not found")
        root = (Path(dist) if dist is not None else WEB_ROOT).resolve()
        target = (root / path).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            raise HTTPException(404, "Not found")
        if target.is_file():
            return FileResponse(target)
        if path.strip("/") in SPA_ROUTES and (root / "index.html").is_file():
            return FileResponse(root / "index.html")
        raise HTTPException(404, "Build frontend first, or check the path")
    return app

app = create_web_app()
