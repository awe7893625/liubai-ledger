"""Existing API + built frontend on one origin. Use a private network or auth gateway."""
from pathlib import Path
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.staticfiles import StaticFiles
from app.main import create_app

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

class SPAFiles(StaticFiles):
    async def get_response(self, path, scope):
        if path == "api" or path.startswith("api/"):
            return JSONResponse({"detail": "API route not found"}, status_code=404)
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or "." in Path(path).name:
                raise
            return await super().get_response("index.html", scope)

def create_web_app(dist=DIST):
    dist = Path(dist)
    if not (dist / "index.html").is_file():
        raise RuntimeError("Build frontend first: cd frontend && npm ci && npm run build")
    app = create_app()
    app.mount("/", SPAFiles(directory=str(dist), html=True), name="ledger-frontend")
    return app

app = create_web_app()
