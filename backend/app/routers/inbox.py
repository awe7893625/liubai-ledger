"""inbox router — T70-Inbox Resolution."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.db import q, q1, q_exec, tx

_EVENT_KIND = {
    "refund": "refund",
    "income": "income",
    "payment": "expense",
    "transfer": "transfer",
}


def _kind_from_event(event: dict, amount: int) -> str:
    """Keep the email's own classification; a refund must not land as income."""
    mapped = _EVENT_KIND.get(str(event.get("event_type") or ""))
    if mapped:
        return mapped
    return "expense" if amount < 0 else "income"


router = APIRouter(prefix="/api/inbox", tags=["inbox"])


@router.get("")
def list_inbox(status: str | None = None):
    if status:
        return q(
              "SELECT * FROM email_events WHERE inbox_status=? ORDER BY created_at DESC",
             status,
          )
    return q("SELECT * FROM email_events ORDER BY created_at DESC")


@router.get("/{eid}")
def get_inbox_item(eid: str):
    r = q1("SELECT * FROM email_events WHERE id=?", eid)
    if not r:
        raise HTTPException(404, "inbox item not found")
    return dict(r)


class InboxResolve(BaseModel):
    funding_account_id: str | None = None
    category_id: str | None = None
    amount_minor: int | None = None
    date: str | None = None          # YYYY-MM-DD
    notes: str | None = None


def _serialize_full(row) -> dict:
    d = dict(row)
    cat = q("SELECT name FROM categories WHERE id=?", d.get("category_id") or "")
    d["category_name"] = cat[0][0] if cat else None
    acc = q("SELECT nickname FROM funding_accounts WHERE id=?", d.get("funding_account_id") or "")
    d["account_nickname"] = acc[0][0] if acc else None
    return d


def _parsed_field(event: dict, keys: list[str]):
    try:
        parsed = json.loads(event.get("parsed_json") or "{}")
    except (TypeError, ValueError):
        parsed = {}
    if not isinstance(parsed, dict):
        return None
    for k in keys:
        v = parsed.get(k)
        if v is not None:
            return v
    return None


@router.post("/{eid}/resolve", status_code=201)
def resolve_inbox_item(eid: str, body: InboxResolve):
    """Turn an inbox email_event into a confirmed transaction (atomic).

    Missing body fields fall back to the event's parsed_json; when neither
    source can supply amount or date the request is rejected (422) rather
    than writing a guessed row.
    """
    event = q1("SELECT * FROM email_events WHERE id=?", eid)
    if not event:
        raise HTTPException(404, "inbox item not found")
    event = dict(event)
    if event.get("inbox_status") == "resolved":
        raise HTTPException(409, "inbox item already resolved")

    funding_account_id = body.funding_account_id or event.get("funding_account_id")
    amount = body.amount_minor if body.amount_minor is not None else \
        _parsed_field(event, ["amount_minor", "amount"])
    occurred = body.date or _parsed_field(event, ["date", "occurred_at"]) \
        or (event.get("received_at") or "")[:10]
    merchant = _parsed_field(event, ["merchant", "merchant_normalized", "subject"])
    if not isinstance(amount, int) or amount == 0:
        raise HTTPException(422, "amount_minor missing or invalid (body or parsed_json)")
    if not funding_account_id or not occurred:
        raise HTTPException(422, "funding_account_id or date missing (body or parsed_json)")
    occurred_at_full = occurred if len(occurred) > 10 else f"{occurred}T00:00:00Z"

    acc = q("SELECT 1 FROM funding_accounts WHERE id=?", funding_account_id)
    if not acc:
        raise HTTPException(404, "funding_account not found")
    if body.category_id:
        cat = q("SELECT 1 FROM categories WHERE id=?", body.category_id)
        if not cat:
            raise HTTPException(404, "category not found")

    txid = "tx-" + uuid.uuid4().hex[:8]
    with tx() as c:
        again = c.execute(
            "SELECT inbox_status FROM email_events WHERE id=?", (eid,)
        ).fetchone()
        if again and dict(again).get("inbox_status") == "resolved":
            raise HTTPException(409, "inbox item already resolved")
        c.execute(
            """INSERT INTO transactions
                (id, user_id, funding_account_id, amount, currency, date, occurred_at,
                 description, merchant, category_id, source, status, notes, kind)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (txid, "local", funding_account_id, amount, "TWD", occurred, occurred_at_full,
             event.get("subject"), merchant if isinstance(merchant, str) else None,
             body.category_id, "email",
             "confirmed", body.notes, _kind_from_event(event, amount)),
        )
        c.execute(
            "UPDATE email_events SET inbox_status='resolved' WHERE id=?", (eid,)
        )
        row = c.execute("SELECT * FROM transactions WHERE id=?", (txid,)).fetchone()
    out = _serialize_full(row)
    out["inbox_item_id"] = eid
    return out


@router.post("/{eid}/dismiss")
def dismiss_inbox_item(eid: str):
    found = q1("SELECT inbox_status FROM email_events WHERE id=?", eid)
    if not found:
        raise HTTPException(404, "inbox item not found")
    if dict(found).get("inbox_status") == "resolved":
        raise HTTPException(409, "inbox item already resolved")
    q_exec("UPDATE email_events SET inbox_status='dismissed' WHERE id=?", eid)
    return {"id": eid, "inbox_status": "dismissed"}
