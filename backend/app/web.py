"""Serve a built Ledger SPA and API on one loopback port for private hosting."""
from pathlib import Path
from fastapi import HTTPException
from fastapi.responses import FileResponse
from app.main import app

WEB_ROOT = Path(__file__).resolve().parents[2] / "frontend" / "dist"
SPA_ROUTES = {"", "dashboard", "ledger", "budget", "capture", "map", "settings", "setup", "assistant", "reflect"}

@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "API route not found")
    root = WEB_ROOT.resolve()
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
