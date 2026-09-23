# Liubai Ledger Cloud v2

This directory is an isolated cloud candidate. It does **not** replace or migrate
the legacy FastAPI/SQLite ledger and it does not change the legacy `/api/wallet`
contract.

## User path

1. Open `/connect` on iPhone.
2. Sign in by email magic link.
3. Install the single `留白自動記帳` Shortcut.
4. Tap **連接這支 iPhone**. The site sends a 10-minute opaque ticket to the
   installed Shortcut through Apple's `shortcuts://x-callback-url` scheme.
5. The Shortcut exchanges that ticket for a device-scoped token and stores it in
   `Shortcuts/LiubaiLedger/device-token.txt`.
6. The user creates one Wallet **Transaction** automation, selects cards, maps
   `amount`, `merchant`, and `card` into a Dictionary, and runs the Shortcut.
7. Future Apple Pay taps post directly from iPhone to Cloud v2.

No Mac, Tailscale, local FastAPI process, API URL copy/paste, or user-managed
Bearer token is required.
## Security principals

Cloud v2 deliberately separates browser identity and ingestion identity.

- **User session**: Supabase Auth JWT. Reads the user's devices and ledger rows.
- **Device token**: random `ldb_dev_...` credential. Can only call wallet ingest.
- **Pair ticket**: high-entropy, SHA-256 hashed at rest, 10-minute expiry,
  single-use claim.

The browser never receives a device token. The database stores only device-token
hashes. Pair tickets and all writes are service-function only. Authenticated
browser sessions receive read-only table grants and tenant-scoped RLS policies.

## Cloud schema

Migration: `supabase/migrations/202609230001_cloud_v2.sql`

- `ledger_pair_tickets`
- `ledger_devices`
- `ledger_wallet_events`
- `ledger_transactions`

Every user-owned table carries `user_id`. `(user_id, request_id)` is unique
for wallet events and transactions.
## Functions

- `pair-start` — requires signed-in user; creates one opaque pair ticket.
- `pair-exchange` — public-by-ticket; consumes ticket and returns one device
  token exactly once.
- `wallet-ingest` — public-by-device-token; validates, deduplicates, and stores
  a transaction. Missing amount or merchant is accepted as `pending` instead
  of silently dropping the event.
- `devices` — requires signed-in user; lists devices and mediates revocation.

`supabase/config.toml` disables platform JWT verification only on the two
credential-authenticated functions (`pair-exchange`, `wallet-ingest`).
The functions perform their own ticket/device-token checks.

## Required deployment configuration

Create a **new** Supabase project for Cloud v2. Do not reuse the private Ledger
database. Apply the migration, deploy functions, then configure:

- `LEDGER_ALLOWED_ORIGIN=https://liubai-ledger.vercel.app`
- current Supabase publishable/secret key environment provided by Supabase
  (the shared helper also keeps legacy anon/service-role fallback for local work)
- Auth redirect allow-list containing
  `https://liubai-ledger.vercel.app/connect`
For the Vercel public site:

- `VITE_SUPABASE_URL=https://<project-ref>.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`
- keep `VITE_PUBLIC_DOCS=1`

Never put a Supabase secret key, device token, private ledger token, bank
credential, or Apple account credential in a `VITE_*` variable.

## Build the Cloud Shortcut

The checked-in source is auditable and contains no user credential.

```bash
LEDGER_CLOUD_API_BASE=https://<project-ref>.supabase.co \
  python3 scripts/build_cloud_shortcut.py

python3 /path/to/shortcuts-playground/scripts/validate_shortcut.py \
  --target-macos 27 --target-platform ios \
  shortcuts/src/Liubai-Cloud.plist

shortcuts sign --mode anyone \
  --input shortcuts/source/Liubai-Cloud.unsigned.shortcut \
  --output frontend/public/shortcuts/Liubai-Cloud.shortcut
```
Do not publish a Shortcut generated with the default
`https://PROJECT.supabase.co` placeholder. CI/release checks should fail if that
placeholder exists in the signed release input.

## Wallet automation still requires one local Apple permission step

The site can install/run a Shortcut and pass an opaque pairing ticket, but it
cannot choose a user's Wallet cards on their behalf. The user still selects cards
inside the iPhone Transaction automation. This is intentionally device-local.

The shortest supported automation is:

1. Trigger: **Transaction**; select cards; **Run Immediately**.
2. Add a Dictionary with:
   - `amount` = Transaction → Amount
   - `merchant` = Transaction → Merchant
   - `card` = Transaction → Card or Pass
3. Run `留白自動記帳` with that Dictionary.

## Release boundary

A Cloud v2 merge/deploy is allowed only after an independent preview has:
- Deno typecheck pass.
- frontend typecheck/lint/build pass.
- Shortcut structure validator pass.
- Apple `shortcuts sign --mode anyone` pass.
- pair/start → pair/exchange → ingest → duplicate → revoke E2E against an
  isolated cloud/test database.
- confirmed that the legacy source checkout and private production services were
  not modified.
