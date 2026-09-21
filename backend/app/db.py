"""DB layer - SQLite via stdlib sqlite3."""
from __future__ import annotations
import os, sqlite3, threading
from contextlib import contextmanager
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_MIGRATIONS = _ROOT / "app" / "migrations"
_LK = threading.Lock()
_CONN = None
_CUR_DB_PATH = None


def _db_path():
    raw = os.getenv("DATABASE_URL", "").strip()
    if raw.startswith("sqlite:///"):
        raw = raw[len("sqlite:///"):]
    if raw == ":memory:":
        return ":memory:"
    if raw:
        p = Path(raw)
        p.parent.mkdir(parents=True, exist_ok=True)
        return str(p)
    default = _ROOT / "data" / "ledger.db"
    default.parent.mkdir(parents=True, exist_ok=True)
    return str(default)


def _get_conn():
    global _CONN
    if _CONN is None:
        with _LK:
            if _CONN is None:
                _CONN = sqlite3.connect(_db_path(), timeout=30, check_same_thread=False)
                _CONN.row_factory = sqlite3.Row
                _CONN.execute("PRAGMA journal_mode = WAL")
                _CONN.execute("PRAGMA foreign_keys = ON")
    return _CONN


def init_db():
    global _CONN, _CUR_DB_PATH
    new_path = _db_path()
    if _CONN is not None and _CUR_DB_PATH == new_path:
        c = _CONN
    else:
        if _CONN is not None:
            try:
                _CONN.close()
            except Exception:
                pass
            _CONN = None
            _CUR_DB_PATH = None
        c = _get_conn()
        _CUR_DB_PATH = new_path
    c.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
     )
    applied = {r[0] for r in c.execute("SELECT version FROM schema_migrations").fetchall()}
    for f in sorted(_MIGRATIONS.glob("*.sql")):
        v = f.stem
        if v in applied:
            continue
        raw = f.read_text(encoding="utf-8")
        filtered = chr(10).join(line for line in raw.splitlines() if not line.lstrip().startswith("PRAGMA"))
        c.executescript(filtered)
        c.execute("INSERT OR IGNORE INTO schema_migrations (id, version) VALUES (?, ?)", (v, v))
    c.commit()


def _norm_params(params):
    if len(params) == 1 and isinstance(params[0], (list, tuple)):
        return tuple(params[0])
    return params


def q(sql, *params):
    c = _get_conn()
    return c.execute(sql, _norm_params(params)).fetchall()


def q1(sql, *params):
    c = _get_conn()
    return c.execute(sql, _norm_params(params)).fetchone()


def q_scalar(sql, *params):
    r = q1(sql, *params)
    return r[0] if r else None


def q_exec(sql, *params):
    """Execute a write on the shared connection and commit.

    Runs INSIDE the write lock so the commit fully releases the write before any
    subsequent read on the shared connection sees the new data. This keeps a
    single shared connection (correct visibility) without the per-call split that
    left writes invisible to the reread.
    """
    with _LK:
        c = _get_conn()
        cur = c.execute(sql, _norm_params(params))
        c.commit()
        return cur.rowcount


@contextmanager
def tx():
     with _LK:
        c = _get_conn()
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


def reset_conn():
    global _CONN, _CUR_DB_PATH
    with _LK:
        if _CONN is None:
            return
        try:
            _CONN.close()
        except Exception:
            pass
        _CONN = None
        _CUR_DB_PATH = None
