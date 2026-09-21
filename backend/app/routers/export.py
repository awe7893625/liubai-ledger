"""export router — T104 data export (JSON / CSV).

GET /api/export?format=json → full dump (transactions, accounts, categories, budgets)
GET /api/export?format=csv  → transactions as CSV
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import Response

from app.db import q

router = APIRouter(prefix="/api/export", tags=["export"])

_STAMP = lambda: datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")  # noqa: E731


@router.get("")
def export_data(format: str = "json"):
    tables = {
        "transactions": q("SELECT * FROM transactions ORDER BY date"),
        "funding_accounts": q("SELECT * FROM funding_accounts"),
        "categories": q("SELECT * FROM categories"),
        "budgets": q("SELECT * FROM budgets"),
        "budget_categories": q("SELECT * FROM budget_categories"),
        "reserved_expenses": q("SELECT * FROM reserved_expenses"),
        "email_events": q("SELECT * FROM email_events"),
    }
    dump = {name: [dict(r) for r in rows] for name, rows in tables.items()}

    if format == "xlsx":
        try:
            from openpyxl import Workbook
            from openpyxl.styles import Font, PatternFill
        except ImportError:
            return Response(content='{"ok":false,"error":"openpyxl not installed"}', status_code=500, media_type="application/json")

        wb = Workbook()
        ws = wb.active
        ws.title = "交易明細"
        txs = dump["transactions"]
        cols = ["date", "occurred_at", "merchant", "description", "amount", "kind",
                "category_id", "source", "status", "notes", "funding_account_id"]
        heads = ["日期", "時間", "商家", "描述", "金額(NT$)", "收支", "分類", "來源", "狀態", "備注", "帳戶"]
        ws.append(heads)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", start_color="D85F2B")
        cat_names = {r["id"]: r["name"] for r in dump["categories"]}
        acc_names = {r["id"]: r["nickname"] for r in dump["funding_accounts"]}
        for r in txs:
            ws.append([
                r.get("date"),
                (r.get("occurred_at") or "")[11:19] or None,
                r.get("merchant") or r.get("description") or "",
                r.get("description") or "",
                round((r.get("amount") or 0) / 100, 2),
                "支出" if (r.get("amount") or 0) < 0 else "收入",
                cat_names.get(r.get("category_id"), "未分類"),
                r.get("source") or "",
                r.get("status") or "",
                (r.get("notes") or "")[:200],
                acc_names.get(r.get("funding_account_id"), ""),
            ])
        for col, w in zip("ABCDEFGHIJK", (12, 10, 32, 28, 12, 7, 10, 12, 9, 30, 14)):
            ws.column_dimensions[col].width = w
        ws.freeze_panes = "A2"

        ws2 = wb.create_sheet("分類表")
        ws2.append(["id", "名稱"])
        for r in dump["categories"]:
            ws2.append([r["id"], r["name"]])
        ws3 = wb.create_sheet("帳戶")
        ws3.append(["id", "名稱"])
        for r in dump["funding_accounts"]:
            ws3.append([r["id"], r["nickname"]])

        bio = io.BytesIO()
        wb.save(bio)
        return Response(
            content=bio.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="ledger-{_STAMP()}.xlsx"'},
        )

    if format == "md":
        lines = ["# Ledger 交易明細", "",
                 f"> 匯出時間：{datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M')}",
                 ""]
        cat_names = {r["id"]: r["name"] for r in dump["categories"]}
        acc_names = {r["id"]: r["nickname"] for r in dump["funding_accounts"]}
        cur_month = None
        month_total = 0
        month_n = 0
        for r in dump["transactions"]:
            if r["date"][:7] != cur_month:
                if cur_month is not None:
                    lines.append(f"**小計：NT${month_total:,.0f}（{month_n} 筆）**")
                    lines.append("")
                cur_month = r["date"][:7]
                lines.append(f"## {cur_month[:7]}")
                lines.append("")
                lines.append("| 日期 | 商家 | 分類 | 帳戶 | 金額 | 備注 |")
                lines.append("|---|---|---|---|---:|---|")
                month_total = 0
                month_n = 0
            amt = (r["amount"] or 0) / 100
            month_total += -amt if amt < 0 else 0
            month_n += 1
            loc = ""
            m = re.search(r"📍([^·]+)", r.get("notes") or "")
            if m:
                loc = m.group(1).strip()
            lines.append(
                f"| {r['date']} | {r['merchant'] or r['description'] or ''} "
                f"| {cat_names.get(r['category_id'], '未分類')} "
                f"| {acc_names.get(r['funding_account_id'], '')} "
                f"| {'-' if amt < 0 else '+'}{abs(amt):,.0f} | {loc or (r['notes'] or '')[:40]} |"
            )
        if cur_month is not None:
            lines.append(f"**小計：NT${month_total:,.0f}（{month_n} 筆）**")
        return Response(
            content="\n".join(lines),
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="ledger-{_STAMP()}.md"'},
        )

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        txs = dump["transactions"]
        if txs:
            header = list(txs[0].keys())
            writer.writerow(header)
            for row in txs:
                writer.writerow([row.get(h) for h in header])
        return Response(
            content=buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="ledger-transactions-{_STAMP()}.csv"'},
        )

    return Response(
        content=json.dumps(dump, ensure_ascii=False, default=str),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="ledger-backup-{_STAMP()}.json"',
        },
    )
