"""AI chat — 記帳問答助理。

使用者可以用自然語言問「這個月花了多少」「主要花在哪」「最大的支出」等問題。
作法：從 DB 預先算好統計（月份合計／分類分布／大筆 Top），塞進 prompt 給本機
gemma4:12b（think:false）回答；失敗 fallback OpenRouter。統計是事實資料，模型只
負責把數字講成人話，不讓它編數字。
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import date, datetime

from fastapi import APIRouter
from pydantic import BaseModel

from app.db import q, tx

router = APIRouter(prefix="/api/ai", tags=["ai"])

OLLAMA_BASE = os.environ.get("LEDGER_OLLAMA_BASE", "http://127.0.0.1:11435")
OLLAMA_MODEL = os.environ.get("LEDGER_OLLAMA_VISION_MODEL", "gemma4:12b")
OPENROUTER_MODEL = os.environ.get("LEDGER_OPENROUTER_MODEL", "deepseek/deepseek-chat-v3.1")
KEY_FILE = os.path.expanduser("~/Projects/scratch/.env")

CATEGORIES = [
    ("c_food", "餐飲"), ("c_transport", "交通"), ("c_home", "居家"),
    ("c_shopping", "購物"), ("c_fun", "娛樂"), ("c_health", "健康"),
    ("c_education", "教育"), ("c_bills", "公共事業"), ("c_travel", "旅遊"),
    ("c_other", "其他"),
]
CAT_NAME = dict(CATEGORIES)


def _load_or_key() -> str | None:
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key
    try:
        with open(KEY_FILE, encoding="utf-8") as fh:
            m = re.search(r"(sk-or-[A-Za-z0-9_-]+)", fh.read())
            return m.group(1) if m else None
    except OSError:
        return None


def _post_json(url: str, payload: dict, timeout: float, headers: dict | None = None) -> dict:
    import urllib.request

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# ---------------------------------------------------------------- stats ----

def _rows(sql: str, args: tuple) -> list[dict]:
    return [dict(zip([c[0] for c in q(sql, *args).description], r)) if False else r
            for r in q(sql, *args)]


def _month_stats(month: str) -> dict:
    total = q(
        "SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM transactions"
        " WHERE date LIKE ? AND amount<0 AND status='confirmed'"
        " AND kind IN ('expense','unknown')", f"{month}%")[0]
    income = q(
        "SELECT COALESCE(SUM(amount),0) s FROM transactions"
        " WHERE date LIKE ? AND amount>0 AND status='confirmed'", f"{month}%")[0]
    cats = q(
        """SELECT c.name name, COALESCE(SUM(t.amount),0) s, COUNT(*) n
           FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
           WHERE t.date LIKE ? AND t.amount<0 AND t.status='confirmed'
           AND t.kind IN ('expense','unknown')
           GROUP BY t.category_id ORDER BY SUM(t.amount) LIMIT 6""", f"{month}%")
    top = q(
        """SELECT date, COALESCE(merchant, description, '') m, amount
           FROM transactions WHERE date LIKE ? AND amount<0 AND status='confirmed'
           AND kind IN ('expense','unknown')
           ORDER BY amount LIMIT 5""", f"{month}%")
    by_account = q(
        """SELECT a.nickname name, COALESCE(SUM(t.amount),0) s
           FROM transactions t LEFT JOIN funding_accounts a ON a.id=t.funding_account_id
           WHERE t.date LIKE ? AND t.amount<0 AND t.status='confirmed'
           AND t.kind IN ('expense','unknown')
           GROUP BY t.funding_account_id ORDER BY SUM(t.amount) LIMIT 4""", f"{month}%")

    # 地區：從 notes 的 📍店名 抓地區關鍵字
    areas = q(
        "SELECT notes FROM transactions"
        " WHERE date LIKE ? AND amount<0 AND status='confirmed'"
        " AND kind IN ('expense','unknown') AND notes LIKE '%📍%'", f"{month}%")
    area_counter: dict[str, int] = {}
    for r in areas:
        m = re.search(r"📍([^·]+)", r["notes"] or "")
        if not m:
            continue
        name = m.group(1).strip()
        for key in ("信義", "南山", "微風", "台中", "台北", "新北", "桃園", "基隆",
                    "通化", "忠孝", "中山", "大安", "松山", "士林", "板橋", "新莊",
                    "中壢", "高雄", "台南", "洲際"):
            if key in name:
                area_counter[key] = area_counter.get(key, 0) + 1
                break

    # 時段分布
    slots = q(
        "SELECT occurred_at, amount FROM transactions"
        " WHERE date LIKE ? AND amount<0 AND status='confirmed'"
        " AND kind IN ('expense','unknown') AND occurred_at IS NOT NULL", f"{month}%")
    slot_names = [("深夜(0-6)", 0, 6), ("早上(6-11)", 6, 11), ("午餐(11-14)", 11, 14),
                  ("下午(14-17)", 14, 17), ("晚餐(17-21)", 17, 21), ("夜間(21-24)", 21, 24)]
    slot_counter = {n: {"n": 0, "spend": 0.0} for n, _, _ in slot_names}
    for r in slots:
        try:
            hh = int((r["occurred_at"] or "")[11:13])
        except ValueError:
            continue
        for n, lo, hi in slot_names:
            if lo <= hh < hi:
                slot_counter[n]["n"] += 1
                slot_counter[n]["spend"] += -r["amount"] / 100
                break

    return {
        "month": month,
        "expense": -total["s"] / 100,
        "n": total["n"],
        "income": income["s"] / 100,
        "cats": [
            {"name": r["name"] or "未分類", "spend": -r["s"] / 100, "count": r["n"]}
            for r in cats
        ],
        "areas": sorted(area_counter.items(), key=lambda kv: -kv[1])[:6],
        "slots": {n: v for n, v in slot_counter.items() if v["n"] > 0},
        "top": [
            {"date": r["date"], "merchant": r["m"] or "（無商家）", "spend": -r["amount"] / 100}
            for r in top
        ],
        "accounts": [
            {"name": r["name"] or "未指定", "spend": -r["s"] / 100} for r in by_account
        ],
    }


def _fmt_stats(s: dict) -> str:
    lines = [
        f"月份：{s['month']}",
        f"支出合計：NT${s['expense']:,.0f}（{s['n']} 筆）",
        f"收入合計：NT${s['income']:,.0f}",
        "分類分布（大→小）：",
    ]
    for c in s["cats"]:
        lines.append(f"  {c['name']}：NT${c['spend']:,.0f}（{c['count']} 筆）")
    lines.append("最大筆支出 Top5：")
    for t in s["top"]:
        lines.append(f"  {t['date']} {t['merchant']}：NT${t['spend']:,.0f}")
    lines.append("支付方式：")
    for a in s["accounts"]:
        lines.append(f"  {a['name']}：NT${a['spend']:,.0f}")
    if s.get("areas"):
        lines.append("消費地區（筆數）：")
        for name, n in s["areas"]:
            lines.append(f"  {name}：{n} 筆")
    if s.get("slots"):
        lines.append("消費時段：")
        for n, v in s["slots"].items():
            lines.append(f"  {n}：{v['n']} 筆 NT${v['spend']:,.0f}")
    return "\n".join(lines)


class AiAskInput(BaseModel):
    question: str
    month: str | None = None  # YYYY-MM，沒給用當月


@router.post("/ask")
def ask(body: AiAskInput):
    question = (body.question or "").strip()
    if not question:
        return {"ok": False, "error": "請輸入問題"}
    month = body.month or datetime.now().strftime("%Y-%m")
    stats = _fmt_stats(_month_stats(month))
    today = date.today().isoformat()

    sys_prompt = (
        "你是 Ledger 記帳助理，專業財務分析師。只能根據提供的統計資料回答，禁止編造數字；"
        "資料裡沒有的就說查不到。回答用繁體中文。\n"
        "使用者問消費習慣/分析時，給結構化專業分析：①總覽（支出/筆數/日均）"
        "②分類占比與排序 ③最大筆明細（日期+商家+金額）④消費地區 ⑤時段習慣"
        "⑥一句可執行的建議。一般問題就精簡回答（<=150字）。金額整數 NT$。\n\n"
        f"今天：{today}\n當月統計：\n{stats}"
    )

    # 1) 本機 gemma4（think:false，快）
    try:
        r = _post_json(
            f"{OLLAMA_BASE}/api/chat",
            {
                "model": OLLAMA_MODEL,
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": question},
                ],
                "stream": False,
                "think": False,
                "options": {"temperature": 0.3, "num_predict": 400},
            },
            timeout=60,
        )
        text = (r.get("message") or {}).get("content", "").strip()
        if text:
            return {"ok": True, "engine": "local", "answer": text}
    except Exception:
        pass

    # 2) OpenRouter fallback
    key = _load_or_key()
    if not key:
        return {"ok": False, "error": "本機 AI 無回應，且沒有 OpenRouter key"}
    try:
        r = _post_json(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                "model": OPENROUTER_MODEL,
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": question},
                ],
            },
            timeout=60,
            headers={"Authorization": f"Bearer {key}"},
        )
        text = r["choices"][0]["message"]["content"].strip()
        return {"ok": True, "engine": "openrouter", "answer": text}
    except Exception as exc:
        return {"ok": False, "error": f"AI 問答失敗：{exc}"}