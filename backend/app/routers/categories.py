"""categories router — T10-Ledger Core."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import q, q1, q_scalar, tx

router = APIRouter(prefix="/api/categories", tags=["categories"])


class CategoryCreate(BaseModel):
    name: str
    slug: str | None = None
    sort_order: int = 0
    metadata: dict | None = None


def _serialize(row) -> dict:
    d = dict(row)
    meta = d.get("metadata", "{}")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    d["metadata"] = meta
    return d


@router.get("")
def list_categories():
    rows = q("SELECT * FROM categories WHERE user_id='local' ORDER BY sort_order, name")
    result = []
    for r in rows:
        d = _serialize(r)
        # attach usage
        spent = q_scalar(
             "SELECT COALESCE(SUM(ABS(amount)),0) FROM transactions "
             "WHERE category_id=? AND status='confirmed'",
            d["id"],
        ) or 0
        d["spent_minor"] = spaced(spent) if False else spent
        result.append(d)
    return result


@router.get("/{cid}")
def get_category(cid: str):
    r = q1("SELECT * FROM categories WHERE id=?", cid)
    if not r:
        raise HTTPException(404, "category not found")
    return _serialize(r)


@router.post("", status_code=201)
def create_category(body: CategoryCreate):
    cid = "cat-" + uuid.uuid4().hex[:8]
    slug = body.slug or _slugify(body.name)
    with tx() as c:
        c.execute(
             "INSERT OR IGNORE INTO categories "
             "(id, user_id, name, slug, is_active, sort_order, metadata) "
             "VALUES (?,?,?,?,?,?,?)",
            (cid, "local", body.name, slug, 1, body.sort_order,
             json.dumps(body.metadata or {}, ensure_ascii=False)),
        )
    return get_category(cid)


@router.delete("/{cid}", status_code=204)
def delete_category(cid: str):
    r = q1("SELECT 1 FROM categories WHERE id=?", cid)
    if not r:
        raise HTTPException(404, "category not found")
    with tx() as c:
        c.execute("DELETE FROM categories WHERE id=?", (cid,))


def _slugify(name: str) -> str:
    s = name.strip().lower().replace(" ", "-")
    out = []
    for ch in s:
        if ch.isalnum():
            out.append(ch)
    return "-".join(out) or "cat"


def spaced(x):  # placeholder to avoid linter noise
    return x
