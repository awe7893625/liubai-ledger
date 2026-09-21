"""capture router — T40 Quick Capture deterministic parser.

Parses a raw one-liner into a structured capture result:
  amount, user-defined account alias, date, transaction kind, merchant and category.
Account aliases come from funding_accounts rather than built-in bank names.

Deterministic only (spec: local first, no LLM dependency). Confidence is
rule-based: 1.0 when amount+merchant both found, lower as pieces go missing.
"""
from __future__ import annotations

import json
import re
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException

from app.db import q

router = APIRouter(prefix="/api/capture", tags=["capture"])

# --- merchant keyword → category slug --------------------------------------
CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "food": ("餐廳", "午餐", "晚餐", "早餐", "咖啡", "便當", "小吃", "超商", "飲料", "手搖", "消夜", "宵夜", "布丁", "food", "mcdonald", "starbucks", "肯德基", "麥當勞", "7-11", "全家", "萊爾富", "全聯", "美廉社"),
    "transport": ("捷運", "公車", "uber", "taxi", "計程車", "加油", "高鐵", "台鐵", "火車", "停車", "ubike", "youbike", "氣油", "汽油"),
    "home": ("房租", "水費", "電費", "瓦斯", "管理費", "home", "家具", "家電"),
    "shopping": ("蝦皮", "momo", "pchome", "amazon", "淘寶", "博客來", "五金", "百貨", "超市", "cosco", "好市多", "購物", "衣服", "鞋"),
    "fun": ("電影", "遊戲", "netflix", "spotify", "steampower", "steam", "ktv", "娛樂", "漫畫", "订阅", "訂閱", "youtube"),
    "health": ("藥局", "診所", "醫院", "健保", "健身", "gym", "world gym", "牙膏", "保健"),
    "education": ("書", "課程", "學費", "udemy", "coursera", "家教"),
    "bills": ("電信", "中華電信", "台灣大哥大", "遠傳", "網路費", "第四台", "保費", "保險", "水電"),
    "travel": ("飯店", " hotel", "機票", "airbnb", "booking", "agoda", "旅遊", "訂房"),
}

REFUND_WORDS = ("退款", "退費", "refund", "刷卡退回")
INCOME_WORDS = ("收入", "薪轉", "薪水", "薪資", "income", "salary", "獎金", "紅包", "股利")

_AMOUNT_RE = re.compile(
    r"(?:(?:NT\$|nt\$|\$|台幣|新台幣)\s*([0-9][0-9,，]*(?:\.[0-9]+)?)"
    r"|([0-9][0-9,，]*(?:\.[0-9]+)?)\s*(?:元|塊|ntd|twd|NT\$))"
    r"|(?:^|\s)([0-9][0-9,，]*(?:\.[0-9]+)?)(?=\s|$)"  # bare number w/ boundaries
)
_INT_RE = re.compile(r"^([0-9][0-9,，]*(?:\.[0-9]+)?)$")


def _parse_amount(text: str) -> tuple[int | None, str]:
    """Return (minor_units, leftover_text). First match wins."""
    m = _AMOUNT_RE.search(text)
    if not m:
        return None, text
    raw = m.group(1) or m.group(2) or m.group(3)
    leftover = (text[: m.start()] + text[m.end():]).strip()
    cleaned = raw.replace(",", "").replace("，", "")
    minor = round(float(cleaned) * 100)
    return minor, leftover


def _parse_date(text: str) -> tuple[str, str]:
    today = date.today()
    for pat, builder in (
        (re.compile(r"(\d{4})-(\d{2})-(\d{2})"), lambda mo: date(int(mo.group(1)), int(mo.group(2)), int(mo.group(3)))),
        (re.compile(r"(?:^|\s)(\d{1,2})/(\d{1,2})(?:\s|$)"), lambda mo: date(today.year, int(mo.group(1)), int(mo.group(2)))),
        (re.compile(r"(?:^|\s)(\d{1,2})-(\d{1,2})(?:\s|$)"), lambda mo: date(today.year, int(mo.group(1)), int(mo.group(2)))),
    ):
        mo = pat.search(text)
        if mo:
            try:
                d = builder(mo)
            except ValueError:
                continue
            leftover = (text[: mo.start()] + text[mo.end():]).strip()
            return d.isoformat(), leftover
    if re.search(r"昨天|昨日", text):
        return (today - timedelta(days=1)).isoformat(), re.sub(r"昨天|昨日", "", text).strip()
    return today.isoformat(), text


def _match_account(text: str) -> tuple[str | None, str]:
    """Match account ID, nickname, issuer, or metadata.aliases from local settings."""
    low = text.lower()
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
                aliases.append((str(value).strip(), row["id"]))
    for alias, account_id in sorted(aliases, key=lambda item: len(item[0]), reverse=True):
        if alias.lower() in low:
            cleaned = re.sub(re.escape(alias), "", text, flags=re.IGNORECASE).strip()
            return account_id, cleaned
    return None, text


def _match_category(text: str) -> tuple[str, str | None]:
    low = text.lower()
    for slug, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in low:
                return slug, kw
    return "other", None


@router.get("")
def list_captures():
    return []


@router.post("", status_code=201)
def capture(body: dict):
    raw = (body.get("raw_text") or "").strip()
    if not raw:
        raise HTTPException(422, "raw_text is required")

    amount_minor, leftover = _parse_amount(raw)
    date_str, leftover = _parse_date(leftover)
    funding_account_id, leftover = _match_account(leftover)

    low = leftover.lower()
    kind = "expense"
    if any(w in low for w in REFUND_WORDS):
        kind = "refund"
    elif any(w in low for w in INCOME_WORDS):
        kind = "income"

    slug, cat_kw = _match_category(leftover)
    cat = q("SELECT id, name FROM categories WHERE slug = ?", (slug,))
    category_id = cat[0]["id"] if cat else "c_other"
    category_name = cat[0]["name"] if cat else "其他"

    merchant = leftover.strip(" ，。,.-") or None
    # drop the matched category keyword from the merchant text
    if cat_kw and merchant:
        merchant = re.sub(re.escape(cat_kw), "", merchant, flags=re.IGNORECASE).strip(" ，。,.-") or None

    if amount_minor is None:
        raise HTTPException(422, f"cannot find amount in: {raw}")

    # sign convention: amount negative = money out (expense), positive = in
    signed = amount_minor if kind in ("income", "refund") else -amount_minor

    confidence = 1.0
    notes_parts: list[str] = []
    if merchant is None:
        confidence -= 0.3
        notes_parts.append("merchant 未辨識")
    if funding_account_id is None:
        confidence -= 0.3
        notes_parts.append("帳戶未指定（預設現金）")
        funding_account_id = "cash"
    if cat_kw is None:
        confidence -= 0.1

    return {
        "amount": signed,
        "currency": "TWD",
        "date": date_str,
        "merchant": merchant or "",
        "merchant_normalized": merchant or "",
        "category_id": category_id,
        "category": category_name,
        "subcategory": None,
        "tag": None,
        "is_recurring": False,
        "confidence": round(max(confidence, 0.1), 2),
        "source": "capture",
        "notes": "；".join(notes_parts),
        "requires_confirm": confidence < 0.8,
        "funding_account_id": funding_account_id,
        "kind": kind,
    }
