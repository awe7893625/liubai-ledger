"""Mixed classification: rule → merchant table → LLM → none."""
from __future__ import annotations

import json
import os
import re
import urllib.request

from app.db import q
from app.utils.categorize import guess_category

CATEGORIES = [
    "c_food", "c_transport", "c_home", "c_shopping", "c_fun",
    "c_health", "c_education", "c_bills", "c_travel", "c_other",
]


def _merchant_default_category(merchant: str) -> str | None:
    if not merchant:
        return None
    rows = q(
        "SELECT raw_name, default_category FROM merchants "
        "WHERE default_category IS NOT NULL ORDER BY length(raw_name) DESC"
    )
    low = merchant.lower()
    for row in rows:
        if row["raw_name"].lower() in low:
            return row["default_category"]
    return None


def _llm_classify(merchant: str, description: str, amount: float) -> tuple[str | None, float | None]:
    base = os.environ.get("LEDGER_OLLAMA_BASE", "http://127.0.0.1:11434")
    model = os.environ.get("LEDGER_OLLAMA_MODEL", "").strip()
    if not model:
        return None, None
    prompt = (
        "你是記帳分類助理。根據商家名稱和描述，判斷這筆交易屬於哪個分類。\n"
        f"可用分類：{', '.join(CATEGORIES)}\n"
        f"商家：{merchant}\n描述：{description}\n金額：{amount} 元\n"
        '只輸出 JSON：{"category": "分類id", "confidence": 0.0到1.0}'
    )
    try:
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "format": "json",
            "think": False,
            "options": {"temperature": 0, "num_predict": 200},
        }
        req_obj = urllib.request.Request(
            f"{base}/api/chat",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req_obj, timeout=10) as resp:
            result = json.loads(resp.read().decode())
        content = result.get("message", {}).get("content", "")
        m = re.search(r"\{.*\}", content, re.S)
        if not m:
            return None, None
        data = json.loads(m.group(0))
        cat = data.get("category")
        conf = float(data.get("confidence", 0))
        if cat in CATEGORIES and conf >= 0.8:
            return cat, round(conf, 2)
        return None, None
    except Exception:
        return None, None


def classify(merchant: str, description: str = "", amount: float = 0) -> tuple[str | None, float | None, str]:
    """Returns (category_id, confidence, method). method: rule/merchant/llm/none."""
    cat = guess_category(merchant) or guess_category(description)
    if cat:
        return cat, 0.95, "rule"

    cat = _merchant_default_category(merchant)
    if cat:
        return cat, 0.9, "merchant"

    cat, conf = _llm_classify(merchant, description, amount)
    if cat:
        return cat, conf, "llm"

    return None, None, "none"
