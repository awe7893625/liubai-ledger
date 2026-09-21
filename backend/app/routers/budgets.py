"""budgets router — T20 Budget Core: CRUD + summary + safe-to-spend + forecast."""
from __future__ import annotations

import json
import uuid

from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.db import q, q1, q_exec, tx
from app.services import budget as eng

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


# ------------------------------------------------------------- schemas

class BudgetUpsert(BaseModel):
    period_month: str                      # YYYY-MM
    total_limit_minor: int
    safety_buffer_minor: int = 0
    metadata: dict | None = None


class BudgetPatch(BaseModel):
    total_limit_minor: int | None = None
    safety_buffer_minor: int | None = None
    metadata: dict | None = None


class CategoryLimit(BaseModel):
    category_id: str
    category_limit_minor: int
    safety_buffer_minor: int = 0


class ReservedCreate(BaseModel):
    name: str
    amount_minor: int
    expected_date: str | None = None       # YYYY-MM-DD
    category_id: str | None = None
    funding_account_id: str | None = None
    notes: str | None = None


class ReservedPatch(BaseModel):
    name: str | None = None
    amount_minor: int | None = None
    expected_date: str | None = None
    category_id: str | None = None
    funding_account_id: str | None = None
    status: str | None = None
    notes: str | None = None


# ------------------------------------------------------------ helpers

def _current_month() -> str:
    return eng.current_month()


def _valid_month(m: str) -> bool:
    if len(m) != 7 or m[4] != "-":
        return False
    try:
        y, mo = int(m[:4]), int(m[5:7])
    except ValueError:
        return False
    return 1 <= mo <= 12 and 2000 <= y <= 2100


def serialize_budget(row) -> dict:
    d = dict(row)
    meta = d.get("metadata", "{}")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    d["metadata"] = meta
    return d


def _zero_budget(month: str) -> dict:
    return {
        "id": None,
        "user_id": "local",
        "period_month": month,
        "total_limit_minor": 0,
        "safety_buffer_minor": 0,
        "metadata": {},
        "spent_minor": 0,
        "remaining_minor": 0,
        "pct_used": 0.0,
        "forecast_end_minor": 0,
        "safe_to_spend_minor": 0,
    }


# --------------------------------------------------------------- T20

@router.get("")
def get_budget(month: str | None = None):
    m = month or _current_month()
    row = eng.get_budget_row(m)
    if not row:
        return _zero_budget(m)
    d = serialize_budget(row)
    # live figures from the engines
    s = eng.budget_summary(m)
    d["spent_minor"] = s["net_spent_minor"]
    d["remaining_minor"] = s["remaining_minor"]
    d["pct_used"] = s["utilization_pct"]
    return d


@router.post("", status_code=201)
def create_budget(body: BudgetUpsert):
    if not _valid_month(body.period_month):
        raise HTTPException(422, "period_month must be YYYY-MM")
    if body.total_limit_minor < 0 or body.safety_buffer_minor < 0:
        raise HTTPException(422, "limits must be >= 0")
    if body.safety_buffer_minor > body.total_limit_minor:
        raise HTTPException(422, "safety_buffer_minor cannot exceed total_limit_minor")
    if eng.get_budget_row(body.period_month):
        raise HTTPException(409, "budget already exists for this month; use PATCH")

    bid = "budget-" + uuid.uuid4().hex[:8]
    with tx() as c:
        c.execute(
            "INSERT INTO budgets (id, user_id, period_month, total_limit_minor, "
            "safety_buffer_minor, metadata) VALUES (?,?,?,?,?,?)",
            (
                bid,
                "local",
                body.period_month,
                body.total_limit_minor,
                body.safety_buffer_minor,
                json.dumps(body.metadata or {}),
            ),
        )
    return serialize_budget(eng.get_budget_row(body.period_month))


@router.patch("/{budget_id}")
def patch_budget(budget_id: str, body: BudgetPatch):
    row = q1("SELECT * FROM budgets WHERE id=? AND user_id='local'", budget_id)
    if not row:
        raise HTTPException(404, "budget not found")

    fields = body.model_dump(exclude_none=True)
    total = int(fields.get("total_limit_minor", row["total_limit_minor"]))
    buffer_ = int(fields.get("safety_buffer_minor", row["safety_buffer_minor"]))
    if total < 0 or buffer_ < 0:
        raise HTTPException(422, "limits must be >= 0")
    if buffer_ > total:
        raise HTTPException(422, "safety_buffer_minor cannot exceed total_limit_minor")

    if not fields:
        return serialize_budget(row)

    sets, vals = [], []
    if "total_limit_minor" in fields:
        sets.append("total_limit_minor=?")
        vals.append(fields["total_limit_minor"])
    if "safety_buffer_minor" in fields:
        sets.append("safety_buffer_minor=?")
        vals.append(fields["safety_buffer_minor"])
    if "metadata" in fields:
        sets.append("metadata=?")
        vals.append(json.dumps(fields["metadata"]))
    sets.append("updated_at=datetime('now')")
    vals.append(budget_id)
    q_exec(f"UPDATE budgets SET {', '.join(sets)} WHERE id=?", *vals)
    return serialize_budget(q1("SELECT * FROM budgets WHERE id=?", budget_id))


# ------------------------------------------------- T20 category limits

@router.get("/{budget_id}/categories")
def get_category_limits(budget_id: str):
    budget = q1("SELECT * FROM budgets WHERE id=?", budget_id)
    if not budget:
        raise HTTPException(404, "budget not found")
    month = budget["period_month"]
    rows = q(
        "SELECT bc.id, bc.budget_id, bc.category_id, bc.category_limit_minor, "
        "bc.safety_buffer_minor, c.name AS category_name, c.slug "
        "FROM budget_categories bc JOIN categories c ON c.id=bc.category_id "
        "WHERE bc.budget_id=? ORDER BY c.sort_order",
        budget_id,
    )
    result = []
    for r in rows:
        d = dict(r)
        spent = eng.category_spent(month, d["category_id"])
        d["spent_minor"] = spent
        lim = d["category_limit_minor"]
        d["remaining_minor"] = lim - spent if lim else None
        d["pct_used"] = round(spent / lim * 100, 1) if lim else None
        result.append(d)
    return result


@router.put("/{budget_id}/categories", status_code=201)
def upsert_category_limit(budget_id: str, body: CategoryLimit):
    if not q1("SELECT 1 FROM budgets WHERE id=?", budget_id):
        raise HTTPException(404, "budget not found")
    if not q1("SELECT 1 FROM categories WHERE id=?", body.category_id):
        raise HTTPException(404, "category not found")
    if body.category_limit_minor < 0 or body.safety_buffer_minor < 0:
        raise HTTPException(422, "limits must be >= 0")
    with tx() as c:
        c.execute(
            "INSERT INTO budget_categories "
            "(id, budget_id, category_id, category_limit_minor, safety_buffer_minor) "
            "VALUES (?,?,?,?,?) "
            "ON CONFLICT(budget_id, category_id) DO UPDATE SET "
            "category_limit_minor=excluded.category_limit_minor, "
            "safety_buffer_minor=excluded.safety_buffer_minor, "
            "updated_at=datetime('now')",
            (
                "bc-" + uuid.uuid4().hex[:8],
                budget_id,
                body.category_id,
                body.category_limit_minor,
                body.safety_buffer_minor,
            ),
        )
    row = q1(
        "SELECT bc.*, c.name AS category_name, c.slug FROM budget_categories bc "
        "JOIN categories c ON c.id=bc.category_id "
        "WHERE bc.budget_id=? AND bc.category_id=?",
        budget_id,
        body.category_id,
    )
    return dict(row)


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, "today must be ISO YYYY-MM-DD")


# ------------------------------------------------------ T21/T22/T23

@router.get("/summary")
def get_summary(month: str | None = None, today: str | None = None):
    return eng.budget_summary(month or _current_month(), _parse_date(today))


@router.get("/categories/summary")
def get_categories_summary(month: str | None = None):
    return eng.category_breakdown(month or _current_month())


@router.get("/safe-to-spend")
def get_safe_to_spend(month: str | None = None, today: str | None = None):
    return eng.safe_to_spend(month or _current_month(), _parse_date(today))


@router.get("/forecast")
def get_forecast(month: str | None = None, today: str | None = None):
    return eng.forecast(month or _current_month(), _parse_date(today))


@router.get("/overview")
def get_full_snapshot(month: str | None = None):
    return eng.full_snapshot(month)


# --------------------------------------------- T22 reserved expenses

@router.get("/{budget_id}/reserved")
@router.get("/reserved")
def list_reserved(month: str | None = None, budget_id: str | None = None):
    if budget_id:
        rows = q(
            "SELECT * FROM reserved_expenses WHERE budget_id=? ORDER BY created_at",
            budget_id,
        )
    else:
        rows = q(
            "SELECT * FROM reserved_expenses WHERE user_id='local' "
            "ORDER BY status, expected_date IS NULL, expected_date, created_at",
        )
    return [dict(r) for r in rows]


@router.post("/reserved", status_code=201)
def create_reserved(body: ReservedCreate, month: str | None = None):
    if body.amount_minor <= 0:
        raise HTTPException(422, "amount_minor must be > 0")
    m = month or _current_month()
    brow = eng.get_budget_row(m)
    if body.category_id and not q1("SELECT 1 FROM categories WHERE id=?", body.category_id):
        raise HTTPException(404, "category not found")
    if body.funding_account_id and not q1(
        "SELECT 1 FROM funding_accounts WHERE id=?", body.funding_account_id
    ):
        raise HTTPException(404, "funding_account not found")

    rid = "res-" + uuid.uuid4().hex[:8]
    with tx() as c:
        c.execute(
            "INSERT INTO reserved_expenses "
            "(id, user_id, budget_id, name, amount_minor, expected_date, "
            "category_id, funding_account_id, notes) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                rid,
                "local",
                brow["id"] if brow else None,
                body.name,
                body.amount_minor,
                body.expected_date,
                body.category_id,
                body.funding_account_id,
                body.notes,
            ),
        )
    return dict(q1("SELECT * FROM reserved_expenses WHERE id=?", rid))


@router.patch("/reserved/{res_id}")
def patch_reserved(res_id: str, body: ReservedPatch):
    row = q1("SELECT * FROM reserved_expenses WHERE id=? AND user_id='local'", res_id)
    if not row:
        raise HTTPException(404, "reserved expense not found")
    if body.status is not None and body.status not in ("pending", "matched", "cancelled"):
        raise HTTPException(422, "invalid status")
    fields = body.model_dump(exclude_none=True)
    if not fields:
        return dict(row)
    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [res_id]
    q_exec(
        f"UPDATE reserved_expenses SET {sets}, updated_at=datetime('now') WHERE id=?",
        *vals,
    )
    return dict(q1("SELECT * FROM reserved_expenses WHERE id=?", res_id))


@router.delete("/reserved/{res_id}", status_code=204)
def delete_reserved(res_id: str):
    if not q1("SELECT 1 FROM reserved_expenses WHERE id=? AND user_id='local'", res_id):
        raise HTTPException(404, "reserved expense not found")
    with tx() as c:
        c.execute("DELETE FROM reserved_expenses WHERE id=?", (res_id,))
