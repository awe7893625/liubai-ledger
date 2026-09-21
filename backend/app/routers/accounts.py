"""accounts router — T10 Ledger Core — funding_accounts."""

import json
import uuid
from datetime import date
from typing import Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import q, q1, tx

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


class AccountCreate(BaseModel):
    type: str
    nickname: str
    issuer: Optional[str] = None
    last4: Optional[str] = None
    currency: str = "TWD"
    sort_order: int = 0
    metadata: Optional[dict] = None


class AccountUpdate(BaseModel):
    type: Optional[str] = None
    nickname: Optional[str] = None
    is_active: Optional[int] = None
    sort_order: Optional[int] = None
    metadata: Optional[dict] = None


def _month_start() -> str:
    today = date.today()
    return f"{today.year:04d}-{today.month:02d}-01 00:00:00"


def _serialize(account_row) -> dict:
    d = dict(account_row)
    meta = d.get("metadata", "{}")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    d["metadata"] = meta

    m = _month_start()
    count_row = q(
        "SELECT COUNT(*) as cnt FROM transactions "
        "WHERE funding_account_id=? AND status != 'archived'",
        d["id"],
     )
    d["tx_count"] = count_row[0][0] if count_row else 0

    spent_row = q(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions "
        "WHERE funding_account_id=? AND status='confirmed' AND amount<0 AND date >= ?",
        d["id"], m,
     )
    d["spent_this_month"] = spent_row[0][0] if spent_row else 0

    return d


@router.get("")
def list_accounts():
    rows = q(
        "SELECT * FROM funding_accounts ORDER BY sort_order, type, nickname"
     )
    return [_serialize(r) for r in rows]


@router.get("/{aid}")
def get_account(aid: str):
    r = q1("SELECT * FROM funding_accounts WHERE id=?", aid)
    if not r:
        raise HTTPException(404, "account not found")
    return _serialize(r)


@router.post("", status_code=201)
def create_account(body: AccountCreate):
    aid = "acc-" + uuid.uuid4().hex[:8]
    with tx() as c:
        c.execute(
             "INSERT INTO funding_accounts (id, user_id, type, issuer, nickname, last4, currency, sort_order, metadata) "
             "VALUES (?,?,?,?,?,?,?,?,?)",
             (aid, "local", body.type, body.issuer, body.nickname,
             body.last4, body.currency, body.sort_order,
             json.dumps(body.metadata or {}, ensure_ascii=False)),
         )
    return get_account(aid)


@router.patch("/{aid}")
def update_account(aid: str, body: AccountUpdate):
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return get_account(aid)

    if "metadata" in fields and isinstance(fields["metadata"], dict):
        fields["metadata"] = json.dumps(fields["metadata"], ensure_ascii=False)

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [aid]

    with tx() as c:
        cur = c.execute(
            f"UPDATE funding_accounts SET {set_clause}, updated_at=datetime('now') WHERE id=?",
            values,
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "account not found")
    return get_account(aid)


@router.delete("/{aid}", status_code=204)
def delete_account(aid: str):
    r = q1("SELECT 1 FROM funding_accounts WHERE id=?", aid)
    if not r:
        raise HTTPException(404, "account not found")

    count_row = q(
        "SELECT COUNT(*) as cnt FROM transactions WHERE funding_account_id=?",
        aid,
     )
    if count_row and count_row[0][0] > 0:
        raise HTTPException(
            409,
            f"cannot delete account with {count_row[0][0]} transactions; deactivate instead",
        )

    with tx() as c:
        c.execute("DELETE FROM funding_accounts WHERE id=?", (aid,))