# Liubai Ledger Cloud v2

Cloud v2 is an isolated candidate for people who want Apple Pay auto-bookkeeping
without keeping a Mac, Tailscale, or FastAPI server online. It does **not**
replace or migrate the legacy FastAPI/SQLite ledger and it does not change the
legacy `/api/wallet` contract.

## Architecture

```text
iPhone Wallet Transaction automation
        ↓
留白自動記帳 Shortcut
        ↓ HTTPS
Vercel /api/v2/*
        ↓
Supabase Auth + Postgres
        ↓
/connect web ledger
```

Vercel owns the application/API runtime. Supabase owns authentication and the
isolated Cloud v2 database. There is no production dependency on Supabase Edge
Functions or the Supabase CLI.
## User path

1. Open `/connect` on iPhone.
2. Sign in with Supabase passwordless email.
3. Install the single `留白自動記帳` Shortcut.
4. Tap **連接這支 iPhone**.
5. The site creates a 10-minute opaque pairing ticket and opens the installed
   Shortcut through Apple's `shortcuts://x-callback-url` scheme.
6. The Shortcut exchanges the ticket at `/api/v2/pair/exchange` for a
   device-scoped token and stores it under
   `Shortcuts/LiubaiLedger/device-token.txt`.
7. The user creates one Wallet **Transaction** automation, selects cards,
   maps `amount`, `merchant`, and `card` into a Dictionary, and runs the
   Shortcut.
8. Future Apple Pay taps post to `/api/v2/wallet/ingest`.

The user never copies an API URL, JSON body, or bearer token.
## Security principals

Cloud v2 separates browser identity and ingestion identity.

- **User session** — Supabase Auth JWT. It can read only that user's rows via RLS
  and can call user-scoped Vercel APIs such as device management.
- **Device token** — random `ldb_dev_...` credential. It can only ingest wallet
  events. It cannot read transactions, export data, or manage the account.
- **Pair ticket** — high entropy, SHA-256 hashed at rest, 10-minute expiry,
  single-use claim.

The browser never receives a device token. The database stores only device-token
hashes. Browser roles get no INSERT grant on Cloud v2 tables; Vercel server
functions mediate writes with the Supabase secret key. Every tenant-owned table
contains `user_id`, and reads are protected by RLS using `auth.uid()`.
## Database

Migration: `supabase/migrations/202609230001_cloud_v2.sql`

Tables:
- `ledger_pair_tickets`
- `ledger_devices`
- `ledger_wallet_events`
- `ledger_transactions`

`(user_id, request_id)` is unique for wallet events and transactions. Missing
amount or merchant is retained as `pending / needs_review` instead of silently
dropping the event.

## Vercel APIs

Canonical handlers live under `frontend/api/v2`:

- `POST /api/v2/pair/start` — authenticated user creates one ticket.
- `POST /api/v2/pair/exchange` — public-by-ticket, returns device token once.
- `POST /api/v2/wallet/ingest` — public-by-device-token, validates and dedupes.
- `GET|POST /api/v2/devices` — authenticated list/revoke.
## Vercel + Supabase Marketplace

Use a **new** Supabase resource connected only to the isolated
`liubai-ledger-cloud-v2-preview` Vercel project. Do not connect it to the
existing `liubai-ledger` project.

The Vercel Marketplace Supabase integration supplies:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- Postgres connection variables such as `POSTGRES_URL`

When the resource is created with `publicEnvVarPrefix=VITE_`, the browser build
receives `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never put
`SUPABASE_SECRET_KEY`, device tokens, bank credentials, or private Ledger
tokens in any `VITE_*` variable.
The Supabase/Vercel integration also maintains Vercel deployment redirect URLs
for Supabase Auth, so preview deployments do not need a hand-maintained list of
every generated Vercel URL.

Provisioning command after the account owner has accepted the Supabase
Marketplace terms:

```bash
vercel integration add supabase \
  --plan free \
  --name liubai-ledger-cloud-v2-preview \
  -m region=hnd1 \
  -m publicEnvVarPrefix=VITE_ \
  --environment production \
  --environment preview \
  --no-claim
```

Legal/Marketplace terms must be accepted by the account owner; automation must
not click acceptance on the owner's behalf.
## Apply the schema

After the Marketplace resource is connected to the preview project:

```bash
cd frontend
vercel env pull .env.cloud-v2.local
set -a
source .env.cloud-v2.local
set +a

psql "$POSTGRES_URL_NON_POOLING" \
  -v ON_ERROR_STOP=1 \
  -f ../cloud/supabase/migrations/202609230001_cloud_v2.sql
```

Use the non-pooling URL for migrations when available. The generated
`.env.cloud-v2.local` is local-only and must never be committed.
## Build and sign the Cloud Shortcut

The checked-in plist source is auditable and contains no user credential.

```bash
LEDGER_CLOUD_API_BASE=https://liubai-ledger-cloud-v2-preview.vercel.app \
  python3 scripts/build_cloud_shortcut.py

python3 /path/to/shortcuts-playground/scripts/validate_shortcut.py \
  --target-macos 27 --target-platform ios \
  shortcuts/src/Liubai-Cloud.plist

shortcuts sign --mode anyone \
  --input shortcuts/source/Liubai-Cloud.unsigned.shortcut \
  --output frontend/public/shortcuts/Liubai-Cloud.shortcut
```

Never publish a Shortcut containing the default `PROJECT.vercel.app`
placeholder.
## Wallet permission boundary

A website or shared Shortcut cannot select Wallet cards on a user's behalf.
The user still performs this device-local Apple permission once:

1. Shortcuts → Automation → **Transaction**.
2. Select the Wallet cards.
3. Choose **Run Immediately**.
4. Add a Dictionary:
   - `amount` = Transaction → Amount
   - `merchant` = Transaction → Merchant
   - `card` = Transaction → Card or Pass
5. Run `留白自動記帳` with that Dictionary.

Everything after that is background HTTPS ingestion from the iPhone.
## Release gates

Before any promotion to the existing public Ledger project:

- Vercel API JS syntax check passes.
- frontend typecheck/lint/build passes.
- Shortcut structure validator passes for iOS 27.
- Apple `shortcuts sign --mode anyone` passes.
- pair → exchange → ingest → duplicate → tenant RLS → revoke E2E passes against
  an isolated Supabase database through **Vercel /api/v2**, not Edge Functions.
- 390 px and desktop browser QA have no overflow or console/page errors.
- secret scan passes.
- legacy source checkout and private production services remain unchanged.

Cloud v2 must first pass a real iPhone transaction on the isolated preview
project. Only then may the owner choose to promote it to the public site.
