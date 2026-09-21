"""transactions router — T10 Ledger Core — CRUD."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import q, q1, q_exec, tx
from app.services.classify import classify

_AUTOMATED_SOURCES = frozenset({"email", "sms", "statement", "capture"})
from app.utils.time import to_storage

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _now_iso() -> str:
    return to_storage(datetime.now(timezone.utc))


class TxCreate(BaseModel):
    funding_account_id: str
    amount: int = Field(ge=-(2**62), le=2**62)   # minor units, positive=income, negative=expense
    currency: str = "TWD"
    date: str                      # YYYY-MM-DD
    description: str | None = None
    merchant: str | None = None
    merchant_normalized: str | None = None
    category_id: str | None = None
    subcategory: str | None = None
    tag: str | None = None
    source: Literal["manual", "telegram", "email", "statement", "sync", "sms", "capture"] = "manual"
    status: Literal["pending", "confirmed", "archived", "duplicate"] = "pending"
    is_recurring: int = 0
    notes: str | None = None
    kind: Literal["expense", "income", "refund", "transfer"] | None = None
    external_id: str | None = None   # idempotency key for automated ingestion
    # omitted -> derived from the sign of amount


class TxUpdate(BaseModel):
    amount: int | None = None
    funding_account_id: str | None = None
    currency: str | None = None
    date: str | None = None
    description: str | None = None
    merchant: str | None = None
    merchant_normalized: str | None = None
    category_id: str | None = None
    subcategory: str | None = None
    tag: str | None = None
    status: Literal["pending", "confirmed", "archived", "duplicate"] | None = None
    is_recurring: int | None = None
    notes: str | None = None
    kind: Literal["expense", "income", "refund", "transfer", "unknown"] | None = None


def _serialize_full(row) -> dict:
    d = dict(row)
         # category name
    cat = q("SELECT name FROM categories WHERE id=?", d.get("category_id") or "")
    d["category_name"] = cat[0][0] if cat else None
         # account nickname
    acc = q("SELECT nickname FROM funding_accounts WHERE id=?", d.get("funding_account_id") or "")
    d["account_nickname"] = acc[0][0] if acc else None
    return d


@router.get("")
def list_transactions(
    funding_account: str | None = None,
    month: str | None = None,
    status: str | None = None,
    limit: int = 100,
):
    clauses = ["t.user_id='local'"]
    params = []
    if funding_account:
        clauses.append("t.funding_account_id=?")
        params.append(funding_account)
    if month:
        clauses.append("t.date LIKE ?")
        params.append(f"{month}-%")
    if status:
        clauses.append("t.status=?")
        params.append(status)
    where = " AND ".join(clauses)
    rows = q(
            f"""
        SELECT t.*, a.nickname AS account_nickname, c.name AS category_name
        FROM transactions t
        LEFT JOIN funding_accounts a ON a.id = t.funding_account_id
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE {where}
        ORDER BY t.date DESC, t.occurred_at DESC
        LIMIT ?
              """,
              *params, limit,
              )
    return [dict(r) for r in rows]


@router.get("/{txid}")
def get_transaction(txid: str):
    rows = q("SELECT * FROM transactions WHERE id=?", txid)
    if not rows:
        raise HTTPException(404, "transaction not found")
    return _serialize_full(rows[0])


def _insert_transaction_row(c, txid: str, body: "TxCreate"):
    c.execute(
              """INSERT INTO transactions
                  (id, user_id, funding_account_id, amount, currency, date, occurred_at,
                   description, merchant, merchant_normalized, category_id, subcategory,
                   tag, source, status, is_recurring, notes, kind, external_id)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (txid, "local", body.funding_account_id, body.amount, body.currency,
                  body.date, _now_iso(), body.description, body.merchant,
                  body.merchant_normalized, body.category_id, body.subcategory,
                  body.tag, body.source, body.status, body.is_recurring,
                  body.notes,
                  body.kind or ("expense" if body.amount < 0 else "income"),
                  body.external_id),
                 )
    return c.execute("SELECT * FROM transactions WHERE id=?", (txid,)).fetchone()


@router.post("", status_code=201)
def create_transaction(body: TxCreate):
    acc = q("SELECT 1 FROM funding_accounts WHERE id=?", body.funding_account_id)
    if not acc:
        raise HTTPException(404, "funding_account not found")

    if body.category_id:
        cat = q("SELECT 1 FROM categories WHERE id=?", body.category_id)
        if not cat:
            raise HTTPException(404, "category not found")

    txid = "tx-" + uuid.uuid4().hex[:8]

    # Idempotency: automated ingestion retries must not duplicate a transaction.
    if body.external_id:
        dup = q("SELECT id FROM transactions WHERE source=? AND external_id=?",
                body.source, body.external_id)
        if dup:
            row = q("SELECT * FROM transactions WHERE id=?", dup[0]["id"])[0]
            return _serialize_full(row)

    # 自動入帳線未帶分類時自動補（與 wallet.py 同管道：rule → merchant → LLM）
    cls_method = None
    if body.category_id is None and body.source in _AUTOMATED_SOURCES:
        try:
            cat, conf, cls_method = classify(body.merchant or body.description or "", body.description or "", abs(body.amount) / 100)
            if cat:
                body.category_id = cat
                body.notes = (body.notes or "") + f" · classify={cls_method}/{conf}"
        except Exception:
            cls_method = "error"

    try:
        with tx() as c:
            row = _insert_transaction_row(c, txid, body)
        if body.external_id and body.source in _AUTOMATED_SOURCES:
            try:
                q_exec(
                    "INSERT OR IGNORE INTO ingest_log (source, external_id, tx_id) VALUES (?,?,?)",
                    body.source, body.external_id, txid,
                )
            except Exception:
                pass
    except sqlite3.IntegrityError:
        if body.external_id:
            dup = q("SELECT * FROM transactions WHERE source=? AND external_id=?",
                    body.source, body.external_id)
            if dup:
                return _serialize_full(dup[0])
        raise HTTPException(409, "duplicate transaction (natural key conflict)")
    return _serialize_full(row)


@router.patch("/{txid}")
def update_transaction(txid: str, body: TxUpdate):
    current = q1("SELECT * FROM transactions WHERE id=?", txid)
    if not current:
        raise HTTPException(404, "transaction not found")

    # exclude_unset (not exclude_none) is intentional: an explicit null category means
    # "clear classification", while an omitted field means "leave it unchanged".
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return _serialize_full(current)

    if "funding_account_id" in fields:
        account_id = fields["funding_account_id"]
        if not account_id or not q1("SELECT 1 FROM funding_accounts WHERE id=?", account_id):
            raise HTTPException(404, "funding_account not found")
    if "category_id" in fields and fields["category_id"] is not None:
        if not q1("SELECT 1 FROM categories WHERE id=?", fields["category_id"]):
            raise HTTPException(404, "category not found")

    # Keep analytics semantics in sync when a user flips expense/income in the editor.
    # Refund/transfer are explicit business concepts and must not be silently rewritten.
    if "amount" in fields and "kind" not in fields and current["kind"] in ("expense", "income", "unknown"):
        fields["kind"] = "expense" if int(fields["amount"]) < 0 else "income"

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [_now_iso(), txid]
    sql = f"UPDATE transactions SET {set_clause}, updated_at = ? WHERE id = ?"
    q_exec(sql, *values)
    row = q1("SELECT * FROM transactions WHERE id=?", txid)
    return _serialize_full(row)


@router.delete("/{txid}", status_code=204)
def delete_transaction(txid: str):
    found = q("SELECT 1 FROM transactions WHERE id=?", txid)
    if not found:
        raise HTTPException(404, "transaction not found")
    with tx() as c:
        c.execute("DELETE FROM transactions WHERE id=?", (txid,))
