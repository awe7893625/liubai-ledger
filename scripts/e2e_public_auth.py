"""Hosted acceptance for the SMTP-independent public beta auth path.

Creates one synthetic username through the public API, exercises login and
recovery, then deletes the synthetic auth user and rate-limit rows. No email is
sent and no private Ledger is accessed.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dotenv import dotenv_values


def request(method, url, *, headers=None, body=None, expected=(200,)):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status, raw = res.status, res.read().decode()
    except urllib.error.HTTPError as exc:
        status, raw = exc.code, exc.read().decode()
    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {}
    if status not in expected:
        raise AssertionError(f"{method} {urllib.parse.urlparse(url).path}: HTTP {status}, expected {expected}")
    return status, payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--expected-project-ref", required=True)
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--browser", action="store_true")
    args = parser.parse_args()
    env = dotenv_values(args.env_file)
    api = str(env["SUPABASE_URL"]).rstrip("/")
    app = args.app_url.rstrip("/")
    ref = args.expected_project_ref
    assert urllib.parse.urlparse(api).hostname == f"{ref}.supabase.co"
    assert urllib.parse.urlparse(app).scheme == "https"
    assert ".ts.net" not in app

    service = env.get("SUPABASE_SERVICE_ROLE_KEY") or env["SUPABASE_SECRET_KEY"]
    admin = {"apikey": service, "Authorization": f"Bearer {service}"}
    started_at = datetime.now(timezone.utc).isoformat()
    username = "qa_" + secrets.token_hex(6)
    old_password = "QaOld!" + secrets.token_urlsafe(18)
    new_password = "QaNew!" + secrets.token_urlsafe(18)
    user_id = None

    try:
        _, signup = request(
            "POST", app + "/api/v2/auth/signup",
            body={"username": username, "password": old_password},
            expected=(201,),
        )
        assert signup.get("ok") is True
        assert signup.get("session", {}).get("access_token")
        first_recovery = signup.get("recovery_code")
        assert isinstance(first_recovery, str) and first_recovery.startswith("LBR-")
        access = signup["session"]["access_token"]
        print("PASS public signup returns a Supabase session and one-time recovery code")

        _, bootstrap = request(
            "POST", app + "/api/v2/bootstrap",
            headers={"Authorization": "Bearer " + access}, body={},
        )
        user_id = bootstrap["profile"]["user_id"]
        assert len(bootstrap.get("accounts", [])) >= 2
        print("PASS signup session owns an isolated Ledger tenant")

        request(
            "POST", app + "/api/v2/auth/signup",
            body={"username": username, "password": old_password},
            expected=(409,),
        )
        print("PASS duplicate username rejected")

        _, login = request(
            "POST", app + "/api/v2/auth/login",
            body={"username": username, "password": old_password},
        )
        assert login.get("session", {}).get("access_token")
        print("PASS username/password login")

        request(
            "POST", app + "/api/v2/auth/recover",
            body={"username": username, "recovery_code": "LBR-wrong", "new_password": new_password},
            expected=(401,),
        )
        _, recovered = request(
            "POST", app + "/api/v2/auth/recover",
            body={"username": username, "recovery_code": first_recovery, "new_password": new_password},
        )
        second_recovery = recovered.get("recovery_code")
        assert isinstance(second_recovery, str) and second_recovery.startswith("LBR-") and second_recovery != first_recovery
        print("PASS valid recovery rotates password and recovery code")

        request(
            "POST", app + "/api/v2/auth/login",
            body={"username": username, "password": old_password},
            expected=(401,),
        )
        _, relogin = request(
            "POST", app + "/api/v2/auth/login",
            body={"username": username, "password": new_password},
        )
        assert relogin.get("session", {}).get("access_token")
        request(
            "POST", app + "/api/v2/auth/recover",
            body={"username": username, "recovery_code": first_recovery, "new_password": old_password},
            expected=(401,),
        )
        print("PASS old password and old recovery code are rejected after rotation")

        if args.browser:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                try:
                    for width in (390, 1280):
                        context = browser.new_context(viewport={"width": width, "height": 900})
                        page = context.new_page()
                        errors = []
                        page.on("pageerror", lambda exc: errors.append(type(exc).__name__))
                        page.goto(app + "/connect", wait_until="networkidle", timeout=60_000)
                        page.get_by_label("帳號名稱", exact=True).fill(username)
                        page.get_by_label("密碼", exact=True).fill(new_password)
                        page.get_by_role("button", name="登入", exact=True).last.click()
                        page.get_by_role("heading", name="先記一筆，確認你的私人帳本已建立", exact=True).wait_for(timeout=30_000)
                        marker = f"QA Public Auth {width}"
                        page.get_by_label("金額", exact=True).fill("42")
                        page.get_by_label("商家 / 項目", exact=True).fill(marker)
                        page.get_by_role("button", name="加入帳本", exact=True).click()
                        page.get_by_text(marker, exact=True).wait_for(timeout=30_000)
                        assert not errors, f"browser errors: {errors}"
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal overflow"
                        page.get_by_role("button", name="登出", exact=True).click()
                        page.get_by_role("heading", name="登入 Ledger", exact=True).wait_for(timeout=30_000)
                        context.close()
                        print(f"PASS {width}px browser login, manual transaction, render, and sign-out")
                finally:
                    browser.close()
        return 0
    finally:
        if user_id:
            status, _ = request(
                "DELETE", api + "/auth/v1/admin/users/" + user_id,
                headers=admin, expected=(200, 204),
            )
            print("CLEANUP synthetic auth user", status)
        encoded = urllib.parse.quote(started_at, safe="")
        request(
            "DELETE",
            api + "/rest/v1/ledger_auth_attempts?created_at=gte." + encoded,
            headers={**admin, "Prefer": "return=minimal"},
            expected=(200, 204),
        )
        print("CLEANUP synthetic rate-limit rows")


if __name__ == "__main__":
    raise SystemExit(main())
