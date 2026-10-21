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
saas_migration = (ROOT / "cloud/supabase/migrations/202610210001_saas_core.sql").read_text()
for table in ("ledger_pair_tickets", "ledger_devices", "ledger_wallet_events", "ledger_transactions"):
    check(f"create table if not exists public.{table}" in migration, f"missing {table}")
    check(f"alter table public.{table} enable row level security" in migration, f"RLS missing {table}")

for table in ("ledger_profiles", "ledger_accounts", "ledger_categories"):
    check(f"create table if not exists public.{table}" in saas_migration, f"missing SaaS table {table}")
    check(f"alter table public.{table} enable row level security" in saas_migration, f"RLS missing SaaS table {table}")

check("grant insert" not in migration.lower(), "browser role must not receive INSERT")
check("grant insert" not in saas_migration.lower(), "SaaS browser role must not receive INSERT")
check("revoke all on public.ledger_pair_tickets from anon, authenticated" in migration, "pair ticket grants not revoked")
check("revoke all on public.ledger_accounts from anon, authenticated" in saas_migration, "account grants not revoked")
check("unique (user_id, request_id)" in migration, "idempotency unique key missing")
check("user_id = auth.uid()" in saas_migration, "SaaS RLS ownership predicate missing")
shortcut = plistlib.loads((ROOT / "shortcuts/src/Liubai-Cloud.plist").read_bytes())
raw = json.dumps(shortcut, ensure_ascii=False)
check(shortcut.get("WFWorkflowName") == "留白自動記帳", "wrong cloud shortcut name")
check("X-Ledger-Device-Token" in raw, "device-token header missing")
check("X-Ledger-Token" not in raw, "legacy ingest token leaked into Cloud shortcut")
check("getcurrentlocation" not in raw, "Cloud shortcut must not request location")
check("REPLACE_WITH" not in raw, "manual user token placeholder remains")
check("Shortcuts/LiubaiLedger/device-token.txt" in raw, "device token persistence path missing")
check('"request_id"' in raw and '"occurred_at"' in raw, "stable request metadata missing from Cloud shortcut")
ingest_source = (ROOT / "frontend/api/v2/wallet/ingest.js").read_text()
check("x-ledger-device-token" in ingest_source.lower(), "Shortcut/API device header contract mismatch")
check("/api/v2/pair/exchange" in raw, "Cloud Shortcut is not using Vercel pair API")
check("/api/v2/wallet/ingest" in raw, "Cloud Shortcut is not using Vercel ingest API")
check("PROJECT.vercel.app" not in raw, "Cloud Shortcut still contains release placeholder")
check(not (ROOT / "cloud/supabase/functions").exists(), "duplicate Supabase Edge Functions backend still present")

for endpoint in (
    "frontend/api/v2/health.js",
    "frontend/api/v2/bootstrap.js",
    "frontend/api/v2/transactions.js",
    "frontend/api/v2/pair/start.js",
    "frontend/api/v2/pair/exchange.js",
    "frontend/api/v2/wallet/ingest.js",
    "frontend/api/v2/devices.js",
):
    check((ROOT / endpoint).is_file(), f"missing Vercel API handler: {endpoint}")

vercel = json.loads((ROOT / "frontend/vercel.json").read_text())
routes = vercel.get("routes", [])
fs_index = next((i for i, route in enumerate(routes) if route.get("handle") == "filesystem"), -1)
block_index = next((i for i, route in enumerate(routes) if route.get("dest") == "/not-an-api.json"), -1)
check(fs_index >= 0 and block_index > fs_index, "Vercel filesystem route must precede legacy API 404 guard")

if errors:
    print("FAIL cloud-v2 static gate")
    for item in errors:
        print(" -", item)
    sys.exit(1)

print("PASS cloud-v2 static gate")
print(" - isolated tables + RLS/grants")
print(" - multi-tenant free SaaS core + server-mediated writes")
print(" - device-scoped Shortcut credential")
print(" - no legacy token/location")
print(" - portable gate: no machine-specific paths or secrets")
