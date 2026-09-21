"""wallet router — iOS Shortcuts「交易（Wallet Transaction）」自動化入帳端點。

POST /api/wallet
Body:
{
  "amount": 120,                    # 元（正數＝支出金額，退款可傳負值）；int/float/numeric string；也接受貨幣格式字串（例如 "$1,199.00"、"NT$188"）
  "merchant": "7-ELEVEN",           # 商家（捷徑輸入）
  "card": "Everyday Visa",          # Wallet 的 Card or Pass 標籤
  "payment_method": "apple_pay",    # 固定
  "occurred_at": "2026-09-03T15:44:21",  # 交易物件日期（若有）；解析失敗則 server 現在
  "time_source": "wallet_transaction",   # 或 "shortcut_trigger"
  "latitude": 25.03,                # optional；GPS 失敗不得擋入帳
  "longitude": 121.56,
  "location_name": "7-ELEVEN 信義店",
  "street": "信義路"
}

冪等：external_id = sha1("wallet|card|amount|occurred_at|merchant")
     同一筆重放（捷徑重試）不會重複記帳。
未知卡片 → funding_account id `unknown`，不 422。
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from app.db import q, q_exec, tx
from app.utils.time import to_storage
from app.services.classify import classify

router = APIRouter(prefix="/api/wallet", tags=["wallet"])

_LOG_PATH = Path(__file__).resolve().parent.parent.parent / "logs" / "wallet_ingest.log"
_CURRENCY_PREFIX_RE = re.compile(r'^(?P<sign>[+-]?)(?P<prefix>[^\d.]*)(?P<num>\d+(?:\.\d+)?)$')


def _wallet_ingest_log_path() -> Path:
    override = os.environ.get("WALLET_INGEST_LOG")
    return Path(override) if override else _LOG_PATH


class WalletCapture(BaseModel):
    amount: float                      # 元
    merchant: str = ""
    card: str = ""
    payment_method: str = "apple_pay"
    occurred_at: str | None = None     # ISO；無則 / 解析失敗則 server 端補現在
    time_source: str = "shortcut_trigger"
    latitude: float | None = None
    longitude: float | None = None
    location_name: str | None = None
    street: str | None = None

    @field_validator("longitude", "latitude", mode="before")
    @classmethod
    def coerce_geo_num(cls, v):
        # 捷徑變數沒綁好時可能送字串（"121.55..."）或空字串——寬容轉 float，
        # 空字串/無效值歸 None，位置 enrichment 失敗不擋入帳
        if v is None or v == "":
            return None
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v.strip())
            except ValueError:
                return None
        return v

    @field_validator("amount", mode="before")
    @classmethod
    def normalize_amount(cls, v):
        if isinstance(v, bool) or v is None:
            raise ValueError(f"amount must be numeric, got {v!r}")
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            s = v.strip()
            try:
                return float(s)
            except ValueError:
                pass
            cleaned = s.replace(",", "").replace(" ", "")
            m = _CURRENCY_PREFIX_RE.match(cleaned)
            if m:
                try:
                    return float(m.group("sign") + m.group("num"))
                except ValueError:
                    pass
            raise ValueError(f"amount must be numeric, got {v!r}") from None
        raise ValueError(f"amount must be numeric, got {v!r}")

    @field_validator("street", "location_name", mode="before")
    @classmethod
    def coerce_geo_str(cls, v):
        # 捷徑 reverse-geocode 失敗時會塞數字 0（09-06 00:10 422 實例：street:0）；
        # 寬容收下轉字串，GPS/位置失敗不得擋入帳（v2 spec 鐵律）
        if v is None or isinstance(v, str):
            return v
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
        raise ValueError(f"must be string or null, got {v!r}")


def _normalize_merchant(merchant: str) -> str:
    if not merchant:
        return merchant
    low = merchant.lower()
    rows = q("SELECT raw_name, normalized_name FROM merchants ORDER BY length(raw_name) DESC")
    for row in rows:
        if row["raw_name"].lower() in low:
            return row["normalized_name"]
    return merchant


def _account_for_card(card: str) -> str:
    """Resolve Wallet's card label against user-defined accounts and aliases."""
    key = (card or "").strip().lower()
    if not key:
        return "unknown"
    aliases: list[tuple[str, str]] = []
    for row in q("SELECT id, nickname, issuer, metadata FROM funding_accounts WHERE is_active=1"):
        values = [row["id"], row["nickname"], row["issuer"]]
        try:
            meta = json.loads(row["metadata"] or "{}")
            values.extend(meta.get("aliases") or [])
        except Exception:
            pass
        for value in values:
            if value:
                aliases.append((str(value).strip().lower(), row["id"]))
    for alias, account_id in sorted(aliases, key=lambda item: len(item[0]), reverse=True):
        if alias and alias in key:
            return account_id
    return "unknown"


def _append_ingest_log(captured_at: datetime, body: WalletCapture) -> None:
    """Debug logging is opt-in because Wallet payloads can contain sensitive data."""
    if os.environ.get("LEDGER_WALLET_DEBUG", "").lower() not in {"1", "true", "yes"}:
        return
    try:
        log_path = _wallet_ingest_log_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps({
            "captured_at": captured_at.isoformat(),
            "amount": body.amount,
            "merchant": body.merchant,
            "occurred_at": body.occurred_at,
        }, ensure_ascii=False)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


@router.post("", status_code=201)
def wallet_capture(body: WalletCapture, x_ledger_token: str | None = Header(default=None)):
    expected_token = os.environ.get("LEDGER_INGEST_TOKEN", "").strip()
    if expected_token and x_ledger_token != expected_token:
        raise HTTPException(status_code=401, detail="invalid ingest token")

    captured_at = datetime.now().astimezone()
    _append_ingest_log(captured_at, body)

    # Compatibility: older shortcuts sometimes put the card label in payment_method.
    # Keep accepting that shape, but new setups should use the dedicated card field.
    card_name = body.card.strip()
    if not card_name and body.payment_method.strip().lower() not in ("apple_pay", ""):
        card_name = body.payment_method.strip()
    if card_name != body.card:
        body.card = card_name

    # 捷徑容錯：word truncation（"shortcut_trigge"）修正為標準值
    ts = (body.time_source or "").strip().lower()
    if ts.startswith("shortcut_trigge"):
        body.time_source = "shortcut_trigger"
    elif ts.startswith("wallet_trans") or ts == "wallet_transaction":
        body.time_source = "wallet_transaction"

    # Skip accidental empty trigger payloads instead of creating ghost transactions.
    if body.amount == 0 and not body.merchant.strip() and not card_name:
        return JSONResponse(
            status_code=200,
            content={"ok": False, "error": "empty capture: amount=0 and no merchant/card, skipped"},
        )

    if not math.isfinite(body.amount):
        # NaN/±Infinity 需在這裡擋（而非 field_validator 內 raise）：pydantic 的
        # RequestValidationError 會把原始值原樣塞進 errors()[0]["input"]，
        # Starlette JSONResponse 序列化預設 allow_nan=False 反而在渲染 422 時自己炸掉。
        return JSONResponse(status_code=422, content={"ok": False, "error": "amount must be finite"})

    account_id = _account_for_card(body.card)

    try:
        dt = datetime.fromisoformat(body.occurred_at)
        if dt.year < 2020:  # Swift Date() 編碼壞值防呆（0001-01-01 等）
            raise ValueError
    except Exception:
        dt = datetime.now().astimezone()
    date_str = dt.strftime("%Y-%m-%d")

    amount_minor = int(round(abs(body.amount) * 100))
    signed = amount_minor if body.amount < 0 else -amount_minor  # 正數＝支出 → 負入帳

    external_id = hashlib.sha1(
        f"wallet|{body.card}|{abs(body.amount)}|{dt.isoformat()}|{body.merchant}".encode()
    ).hexdigest()

    dup = q("SELECT id FROM transactions WHERE source=? AND external_id=?",
            "capture", external_id)
    if dup:
        return JSONResponse(
            status_code=200,
            content={"ok": True, "duplicate": True, "tx_id": dup[0]["id"]},
        )

    time_note = (body.time_source or "shortcut_trigger")
    notes = f"apple_pay · {time_note}"
    store_location = os.environ.get("LEDGER_STORE_LOCATION", "").lower() in {"1", "true", "yes"}
    if store_location and body.location_name:
        notes += f" · 📍{body.location_name}"
    if store_location and body.latitude is not None and body.longitude is not None:
        notes += f" · 🗺️{body.latitude:.5f},{body.longitude:.5f}"

    txn_id = "tx-" + hashlib.sha1(f"{external_id}|{date_str}".encode()).hexdigest()[:8]
    merchant_norm = _normalize_merchant(body.merchant)
    category_id, confidence, cls_method = classify(body.merchant, body.card, abs(body.amount))
    status = "confirmed" if category_id else "pending"
    notes += f" · classify={cls_method}"
    if confidence is not None:
        notes += f"/{confidence}"
    try:
        with tx() as c:
            c.execute(
                """INSERT INTO transactions
                    (id, user_id, funding_account_id, amount, currency, date, occurred_at,
                     description, merchant, merchant_normalized, category_id, subcategory,
                     tag, source, status, is_recurring, notes, kind, external_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (txn_id, "local", account_id, signed, "TWD", date_str,
                 to_storage(dt),
                 f"{body.merchant}（{body.time_source}）", body.merchant, merchant_norm,
                 category_id, None, None, "capture", status, 0,
                 notes, "expense", external_id),
            )
    except sqlite3.IntegrityError:
        dup2 = q("SELECT id FROM transactions WHERE source=? AND external_id=?",
                 "capture", external_id)
        if not dup2:
            # 撞第二組 UNIQUE（自然鍵 user,account,date,amount,merchant,source,status）
            # 時 external_id 反查會撲空 → 補用自然鍵反查（冪等重試不跳 conflict）
            dup2 = q(
                """SELECT id FROM transactions WHERE user_id=? AND funding_account_id=?
                   AND date=? AND amount=? AND merchant_normalized=? AND source=? AND status=?""",
                "local", account_id, date_str, signed, merchant_norm, "capture", status,
            )
        if dup2:
            return JSONResponse(
                status_code=200,
                content={"ok": True, "duplicate": True, "tx_id": dup2[0]["id"]},
            )
        return JSONResponse(
            status_code=200,
            content={"ok": False, "duplicate": "conflict"},
        )
    try:
        q_exec(
            "INSERT OR IGNORE INTO ingest_log (source, external_id, tx_id) VALUES (?,?,?)",
            "capture", external_id, txn_id,
        )
    except Exception:
        pass
    if category_id:
        from app.services.anomaly import check_anomaly
        anomaly = check_anomaly(category_id, signed, date_str)
        if anomaly:
            import logging
            logging.getLogger("ledger.anomaly").warning(
                "Anomaly: %s cat=%s amount=%d median=%d ratio=%.1f",
                body.merchant, category_id, anomaly["amount_minor"],
                anomaly["median_minor"], anomaly["ratio"],
            )
    return {
        "ok": True,
        "tx_id": txn_id,
        "account": account_id,
        "amount": signed,
        "merchant": body.merchant,
    }
