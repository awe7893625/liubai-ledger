# Liubai Ledger Cloud SaaS beta

Cloud is the isolated multi-tenant SaaS candidate for people who want a free
Ledger account without keeping a Mac, Tailscale, or FastAPI server online.
Signed-in users can create manual transactions immediately and may optionally
pair an iPhone for Wallet ingestion. It does **not** replace or migrate the
legacy FastAPI/SQLite ledger and it does not change the legacy `/api/wallet`
contract.

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
isolated Cloud database. There is no production dependency on Supabase Edge
Functions or the Supabase CLI.

## User path

1. Open `/connect` on iPhone or desktop.
2. Create or sign in with a public username + password. Supabase Auth still owns password hashing and sessions; Ledger never stores plaintext passwords.
3. New accounts receive a one-time high-entropy recovery code. Recovery rotates both the password and the recovery code without requiring SMTP.
4. The app bootstraps a free profile, default accounts and categories.
5. The user can record a manual transaction immediately.
6. Optional iPhone automation:
   - install the single `留白自動記帳` Shortcut;
   - tap **連接這支 iPhone**;
   - the site creates a 10-minute opaque pairing ticket and opens the installed
     Shortcut through Apple's `shortcuts://x-callback-url` scheme;
   - the Shortcut exchanges the ticket at `/api/v2/pair/exchange` for a
     device-scoped token and stores it under
     `Shortcuts/LiubaiLedger/device-token.txt`;
   - the user creates one Wallet **Transaction** automation, selects cards,
     maps `amount`, `merchant`, and `card` into a Dictionary, and runs the
     Shortcut.
7. Supported Wallet taps post to `/api/v2/wallet/ingest`.

The user never copies an API URL, JSON body, bearer token, bank password, or
Apple ID credential.
Setup and v2 manual/Wallet download guide: [SHORTCUTS_V2_SETUP.md](../docs/SHORTCUTS_V2_SETUP.md).
Signed public files are served from `app.blankspaces.uk/shortcuts/`; they contain no tenant credentials.

## Security principals

Cloud v2 separates browser identity and ingestion identity.

- **User session** — Supabase Auth JWT. It can read only that user's rows via RLS
  and can call user-scoped Vercel APIs such as device management.
- **Device token** — random `ldb_dev_...` credential. It ingests Wallet or manual
  events and reads only its owner's display label, payment choices and categories
  for the v2 manual Shortcut. It cannot read transactions/balances, export data,
  change payment settings, or manage the account.
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
- `ledger_profiles`
- `ledger_accounts`
- `ledger_categories`
- `ledger_recovery_codes` (server-only)
- `ledger_auth_attempts` (server-only rate-limit buckets)

`(user_id, request_id)` is unique for wallet events and transactions. Missing
amount or merchant is retained as `pending / needs_review` instead of silently
dropping the event.

## Vercel APIs

Canonical handlers live under `frontend/api/v2`:

- `POST /api/v2/auth/signup` — public rate-limited username/password signup;
  creates a Supabase Auth user and returns the recovery code once.
- `POST /api/v2/auth/login` — public rate-limited username/password login.
- `POST /api/v2/auth/recover` — public rate-limited recovery-code password reset;
  rotates the recovery code after successful use.
- `POST /api/v2/bootstrap` — authenticated, idempotently creates the free
  tenant profile plus starter accounts/categories.
- `POST|PATCH|DELETE /api/v2/transactions` — authenticated manual transaction
  mutations, always scoped from the server-validated user session.
- `POST /api/v2/pair/start` — authenticated user creates one ticket.
- `POST /api/v2/pair/exchange` — public-by-ticket, returns device token once.
- `GET /api/v2/wallet/ingest` — device-token-scoped configuration/probe; no ledger reads or transaction creation.
- `POST /api/v2/wallet/ingest` — device-token-scoped Wallet/manual ingest, validates ownership and dedupes.
- `GET|POST|PATCH|DELETE /api/v2/accounts` — authenticated, tenant-scoped payment names and exact Wallet aliases.
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

### Google Sign-In

Google Sign-In uses Google Identity Services in the browser and sends the returned
ID token to `POST /api/v2/auth/google`. The server verifies that token against a
single Web OAuth client ID, maps the Google subject through a server-only hashed
identity table, and returns the same Supabase session shape used by the rest of
Ledger. It requests only `openid email profile`; it does not request Gmail, Drive,
Calendar, Contacts, or other Google API scopes.

Set the same public Web OAuth client ID as:

- `GOOGLE_WEB_CLIENT_ID` for server-side ID-token audience verification.
- `VITE_GOOGLE_WEB_CLIENT_ID` for the Google Identity Services button.

No Google client secret is required by this flow, and no client secret belongs in
`VITE_*` or Git. Production must also expose `/privacy` and `/terms`, and the Google
Auth Platform app should remain External/Production with the exact production
origin listed as an authorized JavaScript origin.

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
