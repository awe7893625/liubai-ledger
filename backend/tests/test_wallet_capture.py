"""POST /api/wallet — TOCTOU 重放、NaN/Infinity 邊界迴歸測試。

案例三刻意不用真執行緒模擬併發：app/db.py 的共用 sqlite3 連線只在
tx()/q_exec() 內用 _LK 上鎖，純讀取的 q() 沒上鎖，多執行緒同時打會直接
segfault（已實測重現，見交付報告），屬 db.py 層級的既有問題，本票不動它。
改用「預先塞一筆撞 (user,fund,date,amount,merchant_normalized,source,status)
唯一鍵、external_id 故意不同」的方式，決定性地逼 INSERT 撞牆走 except 分支。"""
import os


def _fresh_db(pathstr: str):
    for suffix in ["", "-wal", "-shm"]:
        p = pathstr if suffix == "" else pathstr + suffix
        if os.path.exists(p):
            os.remove(p)


def test_wallet_capture():
    db_path = "/tmp/ledger_wallet_test.db"
    _fresh_db(db_path)
    os.environ["DATABASE_URL"] = "sqlite:///{}".format(db_path)

    from app.main import app
    from app.db import init_db, q_exec
    from fastapi.testclient import TestClient

    init_db()
    q_exec(
        "INSERT OR IGNORE INTO funding_accounts "
        "(id,user_id,type,issuer,nickname,currency,metadata) VALUES (?,?,?,?,?,?,?)",
        "card-demo", "local", "credit_card", "Demo Bank", "Demo Visa", "TWD", '{"aliases":["Demo Visa"]}',
    )
    with TestClient(app) as c:
        # 案例一：同 body 序列重放 → 第一次 201、第二次 200 duplicate=true 且 tx_id 一致
        body = {"amount": 120, "merchant": "TEST-REPLAY", "card": "Demo Visa",
                "occurred_at": "2026-09-04T12:00:00"}
        r1 = c.post("/api/wallet", json=body)
        assert r1.status_code == 201, r1.text
        tx_id = r1.json()["tx_id"]

        r2 = c.post("/api/wallet", json=body)
        assert r2.status_code == 200, r2.text
        assert r2.json()["duplicate"] is True
        assert r2.json()["tx_id"] == tx_id

        # 案例二：NaN/Infinity 被 422 擋下（修前會 500）— httpx 的 json= 會在送出前
        # 拒絕非有限浮點數字面值，所以直接送 raw body 讓 server 端的 json.loads 解析
        headers = {"Content-Type": "application/json"}
        r = c.post("/api/wallet", content=b'{"amount":NaN,"merchant":"TEST-NAN"}', headers=headers)
        assert r.status_code == 422, r.text
        r = c.post("/api/wallet", content=b'{"amount":Infinity,"merchant":"TEST-INF"}', headers=headers)
        assert r.status_code == 422, r.text
        r = c.post("/api/wallet", content=b'{"amount":-Infinity,"merchant":"TEST-NINF"}', headers=headers)
        assert r.status_code == 422, r.text

        # 退款語意不回歸：負值照常 201
        r = c.post("/api/wallet", json={"amount": -25, "merchant": "TEST-REFUND", "card": "Demo Visa"})
        assert r.status_code == 201, r.text

        # 案例三：INSERT 階段撞 (user,fund,date,amount,merchant_normalized,source,status)
        # UNIQUE（external_id 刻意不同，繞過前段的 SELECT 快速路徑）→ 逼進 except 分支
        # 使用 Starbucks（classify 規則命中 → status=confirmed，與種子列一致）
        from app.db import q, q_exec
        q_exec(
            """INSERT INTO transactions
                (id, user_id, funding_account_id, amount, currency, date, occurred_at,
                 merchant, merchant_normalized, source, status, kind, external_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            "tx-seed-conflict", "local", "card-demo", -5000, "TWD", "2026-09-04",
            "2026-09-04T10:00:00", "coffee shop", "coffee shop", "capture",
            "confirmed", "expense", "seed-unrelated-external-id",
        )
        r = c.post("/api/wallet", json={"amount": 50, "merchant": "coffee shop",
                                         "card": "Demo Visa", "occurred_at": "2026-09-04T10:00:00"})
        assert r.status_code == 200, r.text
        # 規格：冪等重試一律回 {ok:true, duplicate:true, tx_id}——
        # external_id 反查撲空時 fallback 自然鍵反查，不得回 conflict
        assert r.json() == {"ok": True, "duplicate": True, "tx_id": "tx-seed-conflict"}, r.text

        rows = q("SELECT id FROM transactions WHERE merchant=?", "coffee shop")
        assert len(rows) == 1, "except 分支不得額外插入，still 只有種子那一筆"

    del os.environ["DATABASE_URL"]


def test_wallet_capture_currency_amount():
    db_path = "/tmp/ledger_wallet_currency_test.db"
    _fresh_db(db_path)
    os.environ["DATABASE_URL"] = "sqlite:///{}".format(db_path)

    from app.main import app
    from app.db import init_db, q_exec
    from fastapi.testclient import TestClient

    init_db()
    q_exec(
        "INSERT OR IGNORE INTO funding_accounts "
        "(id,user_id,type,issuer,nickname,currency,metadata) VALUES (?,?,?,?,?,?,?)",
        "card-demo", "local", "credit_card", "Demo Bank", "Demo Visa", "TWD", '{"aliases":["Demo Visa"]}',
    )
    with TestClient(app) as c:
        r = c.post("/api/wallet", json={"amount": "$1,199.00", "merchant": "TEST-CURRENCY-1", "card": "Demo Visa"})
        assert r.status_code == 201, r.text
        assert r.json()["amount"] == -119900
        assert r.json()["account"] == "card-demo"

        r = c.post("/api/wallet", json={"amount": "NT$188", "merchant": "TEST-CURRENCY-2", "card": "Demo Visa"})
        assert r.status_code == 201, r.text
        assert r.json()["amount"] == -18800

        r = c.post("/api/wallet", json={"amount": "12a", "merchant": "TEST-CURRENCY-BAD"})
        assert r.status_code == 422, r.text

    del os.environ["DATABASE_URL"]
