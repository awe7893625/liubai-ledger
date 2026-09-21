"""AI 助理端點：圖片／文字 → 結構化記帳欄位。

優先本機 ollama gemma4:12b（:11435 常駐 vision 小線），失敗 fallback
OpenRouter（key 讀 OPENROUTER_API_KEY env 或 ~/Projects/scratch/.env）。
"""
from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

from app.db import q

router = APIRouter(prefix="/api/ai", tags=["ai"])

OLLAMA_BASE = os.environ.get("LEDGER_OLLAMA_BASE", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("LEDGER_OLLAMA_VISION_MODEL", "").strip()
OPENROUTER_MODEL = os.environ.get("LEDGER_AI_OR_MODEL", "deepseek/deepseek-v4-flash")
OPENROUTER_VISION_MODEL = os.environ.get("LEDGER_AI_VISION_OR_MODEL", "google/gemini-3.5-flash-lite")

CATEGORIES = [
    "c_food", "c_transport", "c_home", "c_shopping", "c_fun",
    "c_health", "c_education", "c_bills", "c_travel", "c_other",
]

def _account_aliases() -> list[tuple[str, str]]:
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
    return aliases


def _account_from_text(text: str | None) -> str | None:
    raw = (text or "").lower()
    for alias, account_id in sorted(_account_aliases(), key=lambda item: len(item[0]), reverse=True):
        if alias.lower() in raw:
            return account_id
    return None


def _clean_account_as_merchant(merchant: str, text: str | None, account: str | None) -> str:
    """Avoid treating a configured account alias as the merchant name."""
    if not text or not account:
        return merchant
    merchant_low = merchant.strip().lower()
    aliases = [a.lower() for a, aid in _account_aliases() if aid == account]
    if merchant_low not in aliases and not any(a in merchant_low for a in aliases):
        return merchant
    cleaned = text
    for alias, aid in _account_aliases():
        if aid == account:
            cleaned = re.sub(re.escape(alias), " ", cleaned, flags=re.I)
    cleaned = re.sub(r"(?:nt\$?|twd|元|塊)", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"[+-]?\d[\d,.]*(?:\.\d+)?", " ", cleaned)
    cleaned = re.sub(r"\b(?:信用卡|刷卡|卡片|card)\b", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"[，,。.!！?？:：;；/|]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -·")
    return cleaned[:80] or merchant


def _prompt(today: str) -> str:
    try:
        account_rows = q("SELECT id, nickname FROM funding_accounts WHERE is_active=1 ORDER BY sort_order, nickname")
    except Exception:
        account_rows = []
    account_hint = "、".join(f"{row['nickname']}={row['id']}" for row in account_rows) or "無"
    return (
        '你是記帳助理。從收據圖片或文字描述擷取記帳資訊，只輸出一個 JSON 物件，'
        '格式：{"amount": 正數金額(元), "kind": "expense"或"income", '
        '"date": "YYYY-MM-DD", "merchant": "商家或消費內容（不可填銀行/卡名）", '
        '"category": "分類id", "account": "帳戶id或null", "notes": "補充備注，可空字串"}。\n'
        "分類 id 只能選：" + "|".join(CATEGORIES) + "。\n"
        f"目前可用帳戶：{account_hint}；判斷不出來填 null。\n"
        f"今天日期：{today}。date 判斷不出來就用今天。金額只取最主要那一筆。"
    )


class AiParseInput(BaseModel):
    text: str | None = None
    image_b64: str | None = None  # 純 base64（可含 data URI 前綴，會自動剝）


def _post_json(
    url: str, payload: dict, timeout: float, headers: dict | None = None
) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _load_or_key() -> str | None:
    """Secrets are read only from the process environment in the open-source build."""
    return os.environ.get("OPENROUTER_API_KEY") or None


def _extract_json(raw: str) -> dict:
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        raise ValueError("model output has no JSON object")
    return json.loads(m.group(0))


def _normalize(data: dict, today: str, source_text: str | None = None) -> dict:
    amount = float(data.get("amount") or 0)
    if not amount > 0:
        raise ValueError("amount must be positive")
    kind = data.get("kind")
    d = str(data.get("date") or today)
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
        d = today
    cat = data.get("category")
    model_account = str(data.get("account") or "").strip()
    valid_account_ids = {account_id for _, account_id in _account_aliases()}
    account = _account_from_text(source_text) or (model_account if model_account in valid_account_ids else None)
    merchant = str(data.get("merchant") or "")[:80]
    merchant = _clean_account_as_merchant(merchant, source_text, account)
    return {
        "amount_minor": round(amount * 100),
        "kind": kind if kind in ("expense", "income") else "expense",
        "date": d,
        "merchant": merchant,
        "category": cat if cat in CATEGORIES else "c_other",
        "account": account,
        "notes": str(data.get("notes") or "")[:200],
    }


@router.post("/parse")
def parse(body: AiParseInput):
    if not body.text and not body.image_b64:
        return {"ok": False, "error": "需要文字或圖片"}
    today = date.today().isoformat()
    images = [body.image_b64.split(",")[-1]] if body.image_b64 else []
    user_content = body.text or "請辨識這張收據圖片並輸出 JSON。"

    # 1) Optional local Ollama-compatible vision model.
    try:
        if not OLLAMA_MODEL:
            raise RuntimeError("local AI model not configured")
        msg: dict = {
            "role": "user",
            "content": _prompt(today) + "\n\n" + user_content,
        }
        if images:
            msg["images"] = images
        r = _post_json(
            f"{OLLAMA_BASE}/api/chat",
            {
                "model": OLLAMA_MODEL,
                "messages": [msg],
                "stream": False,
                "format": "json",
                "think": False,
                "options": {"temperature": 0, "num_predict": 1500},
            },
            timeout=120,
        )
        data = _normalize(_extract_json(r["message"]["content"]), today, body.text)
        return {"ok": True, "engine": "local", **data}
    except Exception:
        pass

    # 2) OpenRouter fallback。圖片必須走 vision-capable model，不能只送「請看圖」文字。
    key = _load_or_key()
    if not key:
        return {"ok": False, "error": "本機 AI 無回應，且沒有 OpenRouter key"}
    try:
        prompt_text = _prompt(today) + "\n\n" + user_content
        if body.image_b64:
            image_url = (
                body.image_b64
                if body.image_b64.startswith("data:")
                else "data:image/jpeg;base64," + body.image_b64
            )
            message_content: str | list[dict] = [
                {"type": "text", "text": prompt_text},
                {"type": "image_url", "image_url": {"url": image_url}},
            ]
            model = OPENROUTER_VISION_MODEL
            engine = "openrouter-vision"
        else:
            message_content = prompt_text
            model = OPENROUTER_MODEL
            engine = "openrouter"

        r = _post_json(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                "model": model,
                "messages": [{"role": "user", "content": message_content}],
            },
            timeout=60,
            headers={"Authorization": f"Bearer {key}"},
        )
        content = r["choices"][0]["message"]["content"]
        data = _normalize(_extract_json(content), today, body.text)
        return {"ok": True, "engine": engine, **data}
    except Exception as exc:
        return {"ok": False, "error": f"AI 解析失敗：{exc}"}
