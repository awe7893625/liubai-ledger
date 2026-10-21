"""Opt-in hosted QA. Uses only fresh synthetic tenants; cleans them in finally.

Does not send emails, test real Apple Pay, or access the private M4 Ledger.
Run with --env-file, --expected-project-ref and --app-url explicitly supplied.
Requires python-dotenv; --browser also requires Playwright + Chromium.
Credentials remain in memory and are never written to reports or screenshots.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dotenv import dotenv_values


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(method, url, headers=None, body=None, expected=(200,)):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method,
        headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=35) as res:
            status, raw = res.status, res.read(2_000_000)
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read(2_000_000)
    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {"not_json": True}
    if status not in expected:
        # Do not echo returned auth objects, credentials or full request URLs.
        code = payload.get("code") if isinstance(payload, dict) else None
        raise AssertionError(f"{method} {urllib.parse.urlparse(url).path}: HTTP {status}, expected {expected}, code={code}")
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--expected-project-ref", required=True)
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--browser", action="store_true")
    parser.add_argument("--local-runtime", action="store_true", help="Test local canonical handlers against hosted DB; NOT a hosted-runtime acceptance")
    args = parser.parse_args()
    env = dotenv_values(args.env_file)
    api = str(env["SUPABASE_URL"]).rstrip("/")
    app = args.app_url.rstrip("/")
    ref = args.expected_project_ref
    assert urllib.parse.urlparse(api).hostname == f"{ref}.supabase.co"
    parsed_app = urllib.parse.urlparse(app)
    if args.local_runtime:
        assert parsed_app.scheme == "http" and parsed_app.hostname == "127.0.0.1"
    else:
        assert parsed_app.scheme == "https"
    assert not parsed_app.path
    assert ".ts.net" not in app, "Never target the private ledger"
    anon = env.get("SUPABASE_ANON_KEY") or env["SUPABASE_PUBLISHABLE_KEY"]
    service = env.get("SUPABASE_SERVICE_ROLE_KEY") or env["SUPABASE_SECRET_KEY"]
    admin = {"apikey": service, "Authorization": f"Bearer {service}"}
    public = {"apikey": anon}
    report = {"at": datetime.now(timezone.utc).isoformat(), "app_url": app,
              "project_ref": ref, "runtime": "loopback_with_hosted_db" if args.local_runtime else "hosted", "checks": [], "cleanup": [],
              "not_tested": ["real email delivery", "real iPhone import/pairing", "real Apple Pay trigger"]}
    created = []
    run_id = secrets.token_hex(6)
    failure = None

    def passed(name):
        report["checks"].append({"name": name, "status": "PASS"})
        print("PASS", name, flush=True)

    def user(label):
        email = f"ledger-qa-{label}-{run_id}@example.invalid"
        password = "QA!" + secrets.token_urlsafe(24)
        record = request("POST", api + "/auth/v1/admin/users", admin,
                         {"email": email, "password": password, "email_confirm": True}, (200, 201))
        created.append(record["id"])
        session = request("POST", api + "/auth/v1/token?grant_type=password", public,
                          {"email": email, "password": password})
        auth = {"Authorization": "Bearer " + session["access_token"]}
        return record["id"], session, auth, {**public, **auth}

    try:
        health = request("GET", app + "/api/v2/health")
        assert health.get("ok") is True
        passed("API health and hosted database connectivity")
        uid_a, session_a, auth_a, rest_a = user("a")
        uid_b, _, auth_b, rest_b = user("b")
        passed("two synthetic users authenticate against hosted Supabase")
        boot_a = request("POST", app + "/api/v2/bootstrap", auth_a, {})
        boot_b = request("POST", app + "/api/v2/bootstrap", auth_b, {})
        again = request("POST", app + "/api/v2/bootstrap", auth_a, {})
        assert len(boot_a["accounts"]) == len(again["accounts"]) == 2
        assert len(boot_a["categories"]) == 8
        assert not {r["id"] for r in boot_a["accounts"]} & {r["id"] for r in boot_b["accounts"]}
        passed("idempotent tenant bootstrap and separate accounts")
        body = {"request_id": "manual-"+run_id, "amount": "123.45", "merchant": "QA Synthetic Lunch",
                "account_id": boot_a["accounts"][0]["id"], "category_id": boot_a["categories"][0]["id"],
                "occurred_at": datetime.now(timezone.utc).isoformat(), "user_id": uid_b}
        tx = request("POST", app + "/api/v2/transactions", auth_a, body, (201,))["transaction"]
        assert tx["amount_minor"] == -12345
        replay = request("POST", app + "/api/v2/transactions", auth_a, body)
        assert replay["duplicate"] and replay["transaction"]["id"] == tx["id"]
        rows_a = request("GET", api + "/rest/v1/ledger_transactions?select=id,user_id,amount_minor", rest_a)
        rows_b = request("GET", api + "/rest/v1/ledger_transactions?select=id", rest_b)
        assert len(rows_a) == 1 and rows_a[0]["user_id"] == uid_a and rows_b == []
        passed("manual write, exact replay and client-supplied owner ignored")
        request("POST", app + "/api/v2/transactions", auth_b, body, (400,))
        request("PATCH", app + "/api/v2/transactions", auth_b, {"id": tx["id"], "merchant": "NOT ALLOWED"}, (404,))
        request("DELETE", app + "/api/v2/transactions", auth_b, {"id": tx["id"]}, (404,))
        request("POST", api + "/rest/v1/ledger_transactions", rest_a,
                {"user_id": uid_a, "request_id": "direct-write"}, (401, 403))
        request("GET", api + "/rest/v1/ledger_transactions?select=id", public, expected=(401, 403))
        passed("cross-tenant write/delete and anonymous/direct browser writes denied")
        pair = request("POST", app + "/api/v2/pair/start", auth_a, {}, (201,))
        exchange = request("POST", app + "/api/v2/pair/exchange", body={"pair_ticket": pair["pair_ticket"], "device_name": "Synthetic QA iPhone"}, expected=(201,))
        request("POST", app + "/api/v2/pair/exchange", body={"pair_ticket": pair["pair_ticket"]}, expected=(409, 410))
        device_auth = {"X-Ledger-Device-Token": exchange["device_token"]}
        passed("single-use ticket exchange (API simulation, not iPhone pairing)")
        wallet = {"request_id": "wallet-"+run_id, "amount": "NT$188", "merchant": "QA Synthetic Coffee",
                  "card": "QA Card", "currency": "TWD", "occurred_at": datetime.now(timezone.utc).isoformat()}
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: request("POST", app + "/api/v2/wallet/ingest", device_auth, wallet, (200, 201)), range(4)))
        assert all(r.get("ok") and r.get("tx_id") for r in results)
        assert len({r["tx_id"] for r in results}) == 1
        assert sum(not r["duplicate"] for r in results) == 1
        rows = request("GET", api + "/rest/v1/ledger_transactions?select=id&request_id=eq.wallet-"+run_id, rest_a)
        assert len(rows) == 1
        passed("four concurrent wallet requests create exactly one transaction")
        pending = request("POST", app + "/api/v2/wallet/ingest", device_auth,
                          {"request_id": "pending-"+run_id, "card": "QA Card"}, (201,))
        assert pending["needs_review"] and pending["status"] == "pending" and pending["tx_id"]
        request("GET", api + "/rest/v1/ledger_pair_tickets?select=id", rest_a, expected=(401, 403))
        request("POST", app + "/api/v2/transactions", device_auth, body, (401,))
        passed("missing Wallet fields retained pending; device cannot use user APIs")
        request("POST", app + "/api/v2/devices", auth_b, {"device_id": exchange["device"]["id"]}, (404,))
        request("POST", app + "/api/v2/devices", auth_a, {"device_id": exchange["device"]["id"]})
        request("POST", app + "/api/v2/wallet/ingest", device_auth,
                {**wallet, "request_id": "revoked-"+run_id}, (401,))
        passed("only owner revokes device; revoked token rejected")
        if args.browser:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                try:
                    for width in (390, 1280):
                        context = browser.new_context(viewport={"width": width, "height": 900})
                        # Ephemeral context; do not save cookies or storageState.
                        context.add_init_script("localStorage.setItem(" + json.dumps(f"sb-{ref}-auth-token") + "," + json.dumps(json.dumps(session_a)) + ");")
                        page = context.new_page()
                        errors = []
                        page.on("pageerror", lambda exc: errors.append(type(exc).__name__))
                        page.goto(app + "/connect", wait_until="networkidle", timeout=60000)
                        page.get_by_role("heading", name="最近交易", exact=True).wait_for(timeout=30000)
                        page.get_by_label("金額", exact=True).fill("42")
                        marker = f"QA Browser {width} {run_id}"
                        page.get_by_label("商家 / 項目", exact=True).fill(marker)
                        page.get_by_role("button", name="加入帳本", exact=True).click()
                        page.get_by_text(marker, exact=True).wait_for(timeout=30000)
                        assert not errors, "Browser JavaScript error"
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal overflow"
                        out = Path(args.report).parent / f"cloud-synthetic-{width}.png"
                        page.screenshot(path=str(out), full_page=True)
                        context.close()
                        passed(f"authenticated {width}px browser form writes and renders real hosted transaction")
                finally:
                    browser.close()
    except Exception as exc:
        failure = exc
        report["checks"].append({"name": "run", "status": "FAIL", "error_type": type(exc).__name__, "message": str(exc)[:250]})
    finally:
        for uid in reversed(created):
            try:
                request("DELETE", api + "/auth/v1/admin/users/" + uid, admin, expected=(200, 204))
                report["cleanup"].append({"synthetic_user_deleted": True})
            except Exception as exc:
                report["cleanup"].append({"synthetic_user_deleted": False, "error_type": type(exc).__name__})
                failure = failure or exc
        report["status"] = "FAIL" if failure else "PASS"
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2))
    if failure:
        raise failure
    runtime = "loopback runtime + hosted DB" if args.local_runtime else "hosted cloud"
    print(f"PASS {runtime} E2E; synthetic users removed. Email delivery and iPhone remain separate release gates.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
