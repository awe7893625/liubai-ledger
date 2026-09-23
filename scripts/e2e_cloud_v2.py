"""Local E2E for Liubai Ledger Cloud v2.

Requires an isolated local Supabase stack started from ./cloud.
Creates and deletes a synthetic auth user; never targets production.
"""
from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import urllib.error
import urllib.request


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOUD = os.path.join(ROOT, "cloud")


def supabase_env() -> dict[str, str]:
    proc = subprocess.run(
        ["npx", "--yes", "supabase@latest", "status", "-o", "env"],
        cwd=CLOUD,
        text=True,
        capture_output=True,
        check=True,
    )
    out: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip('"')
    return out


def request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: object | None = None,
    expected: tuple[int, ...] = (200,),
) -> tuple[int, object]:
    data = None if body is None else json.dumps(body).encode()
    merged = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=merged)
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            raw = res.read().decode()
            status = res.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode()
    parsed: object
    try:
        parsed = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        parsed = raw
    if status not in expected:
        raise AssertionError(f"{method} {url}: expected {expected}, got {status}: {parsed!r}")
    return status, parsed
def main() -> int:
    env = supabase_env()
    api = env.get("API_URL", "http://127.0.0.1:54321").rstrip("/")
    anon = env.get("ANON_KEY")
    service = env.get("SERVICE_ROLE_KEY")
    if not anon or not service:
        raise RuntimeError("Local Supabase keys unavailable")

    email = f"ledger-e2e-{secrets.token_hex(5)}@example.invalid"
    password = "E2e!" + secrets.token_urlsafe(18)
    admin_headers = {"apikey": service, "Authorization": f"Bearer {service}"}
    public_headers = {"apikey": anon}

    _, created = request(
        "POST",
        f"{api}/auth/v1/admin/users",
        headers=admin_headers,
        body={"email": email, "password": password, "email_confirm": True},
        expected=(200, 201),
    )
    assert isinstance(created, dict) and created.get("id")
    user_id = str(created["id"])

    try:
        _, login = request(
            "POST",
            f"{api}/auth/v1/token?grant_type=password",
            headers=public_headers,
            body={"email": email, "password": password},
            expected=(200,),
        )
        assert isinstance(login, dict) and login.get("access_token")
        access = str(login["access_token"])
        user_headers = {"apikey": anon, "Authorization": f"Bearer {access}"}

        _, pair = request(
            "POST",
            f"{api}/functions/v1/pair-start",
            headers=user_headers,
            body={},
            expected=(201,),
        )
        assert isinstance(pair, dict) and pair.get("pair_ticket")
        ticket = str(pair["pair_ticket"])
        _, exchanged = request(
            "POST",
            f"{api}/functions/v1/pair-exchange",
            headers=public_headers,
            body={"pair_ticket": f"pair:{ticket}", "device_name": "E2E iPhone"},
            expected=(201,),
        )
        assert isinstance(exchanged, dict) and exchanged.get("device_token")
        device_token = str(exchanged["device_token"])
        device_id = str(exchanged["device"]["id"])

        request(
            "POST",
            f"{api}/functions/v1/pair-exchange",
            headers=public_headers,
            body={"pair_ticket": ticket, "device_name": "Replay"},
            expected=(410,),
        )

        tx_body = {
            "request_id": "e2e-fixed-request",
            "amount": "NT$188",
            "merchant": "E2E Coffee",
            "card": "Demo Visa",
            "currency": "TWD",
            "occurred_at": "2026-09-24T00:20:00+08:00",
            "payment_method": "apple_pay",
            "time_source": "shortcut_trigger",
        }
        device_headers = {**public_headers, "X-Ledger-Device-Token": device_token}
        _, first = request(
            "POST",
            f"{api}/functions/v1/wallet-ingest",
            headers=device_headers,
            body=tx_body,
            expected=(201,),
        )
        assert isinstance(first, dict) and first.get("duplicate") is False and first.get("tx_id")
        tx_id = str(first["tx_id"])

        _, replay = request(
            "POST",
            f"{api}/functions/v1/wallet-ingest",
            headers=device_headers,
            body=tx_body,
            expected=(200,),
        )
        assert isinstance(replay, dict) and replay.get("duplicate") is True
        assert replay.get("tx_id") == tx_id
        _, rows = request(
            "GET",
            f"{api}/rest/v1/ledger_transactions?select=id,amount_minor,merchant,status&request_id=eq.e2e-fixed-request",
            headers=user_headers,
            expected=(200,),
        )
        assert isinstance(rows, list) and len(rows) == 1
        assert rows[0]["amount_minor"] == -18800
        assert rows[0]["merchant"] == "E2E Coffee"
        assert rows[0]["status"] == "confirmed"

        request(
            "POST",
            f"{api}/functions/v1/devices",
            headers=user_headers,
            body={"device_id": device_id},
            expected=(200,),
        )
        request(
            "POST",
            f"{api}/functions/v1/wallet-ingest",
            headers=device_headers,
            body={**tx_body, "request_id": "e2e-after-revoke"},
            expected=(401,),
        )

        _, forbidden = request(
            "GET",
            f"{api}/rest/v1/ledger_pair_tickets?select=id",
            headers=user_headers,
            expected=(401, 403),
        )
        _ = forbidden

        print("PASS cloud-v2 local E2E")
        print(" - auth session")
        print(" - single-use pairing ticket")
        print(" - device token exchange")
        print(" - wallet ingest + exact duplicate")
        print(" - tenant read via RLS")
        print(" - device revoke blocks future ingest")
        print(" - pair-ticket table not readable by browser role")
        return 0
    finally:
        request(
            "DELETE",
            f"{api}/auth/v1/admin/users/{user_id}",
            headers=admin_headers,
            expected=(200, 204),
        )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAIL cloud-v2 local E2E: {exc}", file=sys.stderr)
        raise
