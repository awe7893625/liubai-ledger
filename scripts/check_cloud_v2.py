"""Static release gate for the isolated Cloud v2 candidate."""
from __future__ import annotations

import json
import plistlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


migration = (ROOT / "cloud/supabase/migrations/202609230001_cloud_v2.sql").read_text()
for table in ("ledger_pair_tickets", "ledger_devices", "ledger_wallet_events", "ledger_transactions"):
    check(f"create table if not exists public.{table}" in migration, f"missing {table}")
    check(f"alter table public.{table} enable row level security" in migration, f"RLS missing {table}")

check("grant insert" not in migration.lower(), "browser role must not receive INSERT")
check("revoke all on public.ledger_pair_tickets from anon, authenticated" in migration, "pair ticket grants not revoked")
check("unique (user_id, request_id)" in migration, "idempotency unique key missing")
shortcut = plistlib.loads((ROOT / "shortcuts/src/Liubai-Cloud.plist").read_bytes())
raw = json.dumps(shortcut, ensure_ascii=False)
check(shortcut.get("WFWorkflowName") == "留白自動記帳", "wrong cloud shortcut name")
check("X-Ledger-Device-Token" in raw, "device-token header missing")
check("X-Ledger-Token" not in raw, "legacy ingest token leaked into Cloud shortcut")
check("getcurrentlocation" not in raw, "Cloud shortcut must not request location")
check("REPLACE_WITH" not in raw, "manual user token placeholder remains")
check("Shortcuts/LiubaiLedger/device-token.txt" in raw, "device token persistence path missing")
check('"request_id"' in raw and '"occurred_at"' in raw, "stable request metadata missing from Cloud shortcut")
ingest_source = (ROOT / "cloud/supabase/functions/wallet-ingest/index.ts").read_text()
check("X-Ledger-Device-Token" in ingest_source, "Shortcut/API device header contract mismatch")

if errors:
    print("FAIL cloud-v2 static gate")
    for item in errors:
        print(" -", item)
    sys.exit(1)

print("PASS cloud-v2 static gate")
print(" - isolated tables + RLS/grants")
print(" - device-scoped Shortcut credential")
print(" - no legacy token/location")
print(" - portable gate: no machine-specific paths or secrets")
