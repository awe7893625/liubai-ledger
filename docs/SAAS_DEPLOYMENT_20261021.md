# Ledger SaaS deployment receipt — 2026-10-21

## Release decision

**Production runtime is deployed and public Beta registration is operational
without external SMTP.** The Supabase Marketplace terms gate is resolved, Tokyo
database provisioning/migration is complete, and the isolated Vercel production
alias serves the multi-tenant Cloud build with a healthy database connection.
Username/password signup uses Supabase Auth for password hashing/sessions and a
high-entropy one-time recovery code for password recovery. Email/OAuth is now an
optional future enhancement, not a release blocker.

## Completed in this run

- Provisioned the requested Supabase **Free**, Tokyo/HND resource through the
  already linked isolated Vercel preview project.
- Connected production and preview environment variables without logging secrets.
- Applied `202609230001_cloud_v2.sql`, `202610210001_saas_core.sql`, and
  `202610210002_public_beta_auth.sql` with hash-tracked guarded migrations.
- Connected to Postgres using TLS with CA and hostname verification (`verify-full`).
- Verified RLS enabled on all seven Ledger tables; anonymous reads and direct
  authenticated browser writes denied; service-role writes available.
- Added `scripts/e2e_cloud_hosted.py`, an opt-in acceptance runner using synthetic
  tenants only, with cleanup, explicit project identity checks and redacted output.
- Fixed the Vercel SPA fallback rewriting Vite module URLs to HTML in local dev.
  API 404 behavior stays fail-closed; module paths do not become SPA documents.
- Found the isolated Vercel preview project had been connected to the wrong GitHub
  repository (`awe7893625/pikmin-architect`). That connection was removed. Direct
  GitHub reconnection to `awe7893625/liubai-ledger` was unavailable to the current
  Vercel Git integration, so the successful production release used Vercel's
  authenticated manual CLI deployment from a clean Git archive. No repository
  permission or author identity was rewritten.
- Production deployment `dpl_6251dRj6MDHdU7fh1kWvDFauvuGc` first reached READY.
- Public-auth production deployment `dpl_D48hMjxykkYNzBYoekHWX6kdaupM` then reached
  READY and replaced the same alias: `https://liubai-ledger-cloud-v2-preview.vercel.app`.
- Public auth is rate-limited server-side, caps the initial free Beta at 500
  username accounts, uses non-routable internal Auth emails, and stores only a
  SHA-256 recovery-code hash in a server-only RLS table.

## What was actually tested

Two acceptance passes were run. The first used **loopback Vercel API runtime +
the real hosted Tokyo Supabase database**. After the production deployment was
READY, the same suite was rerun against the actual HTTPS production alias. The
final production report records `runtime=hosted`.

The final production run passed 11 checks:

1. API health / hosted database connectivity.
2. Two new synthetic users authenticate against hosted Supabase.
3. Idempotent bootstrap and separate tenant accounts.
4. Manual transaction and replay; client-supplied ownership ignored.
5. Cross-tenant mutation, anonymous reads and direct browser writes denied.
6. Single-use pairing ticket exchange via API.
7. Four concurrent Wallet requests create exactly one transaction.
8. Missing Wallet fields remain pending; device tokens cannot use user APIs.
9. Only owner can revoke device; revoked token is rejected.
10. Authenticated 390px browser form writes and renders a hosted transaction.
11. Authenticated 1280px browser form writes and renders a hosted transaction.

Both browser contexts were ephemeral and used synthetic sessions. No real user
cookies or bank data were used. Test users were deleted in `finally`; final hosted
auth-user and transaction counts were both zero. No private M4 Ledger was touched.

Local evidence is in the ignored `.qa/` directory:
- `cloud-migrations-20261021.json`
- `hosted-db-e2e-20261021.json` (initial browser failure, preserved)
- `hosted-db-e2e-20261021-retest.json` (loopback runtime + hosted DB PASS)
- `hosted-production-acceptance-20261021.json` (actual HTTPS production PASS)
- `cloud-synthetic-390.png` and `cloud-synthetic-1280.png`

After the production acceptance cleanup, the hosted project was verified to have
zero synthetic auth users, transactions, devices and wallet events.

A separate public-auth production acceptance then passed:

1. Public username/password signup returned a Supabase session and recovery code.
2. The new session bootstrapped its own isolated Ledger tenant.
3. Duplicate usernames were rejected.
4. Username/password login succeeded.
5. Wrong recovery code was rejected.
6. Correct recovery reset the password and rotated the recovery code.
7. Old password and old recovery code were rejected after rotation.
8. 390px browser login, manual transaction, render and sign-out passed.
9. 1280px browser login, manual transaction, render and sign-out passed.

The synthetic auth user and rate-limit rows were deleted after this acceptance.

## Remaining release gates

- Verify real iPhone Shortcut import, pairing and Wallet tap automation separately.
  API pairing simulation is not real-device acceptance. This blocks claiming
  automatic Apple Pay capture is production-ready, but does **not** block the
  manual multi-tenant SaaS Beta.
- Restore automated Git-based deployments later by granting the Vercel Git
  integration access to `awe7893625/liubai-ledger`; current production is valid,
  but future releases are manual until that connection is repaired.
- Email/OAuth may be added later for convenience and conventional account recovery;
  public Beta signup no longer depends on SMTP.

## Reproduction

Install Python tooling in an isolated environment (`python-dotenv`; for browser
checks also `playwright` plus its Chromium runtime). Keep `.env.saas.local` local,
ignored by Git and mode 0600. Never paste its contents into reports or chat.

```sh
python3 scripts/e2e_cloud_hosted.py \
  --env-file frontend/.env.saas.local \
  --expected-project-ref "$EXPECTED_SUPABASE_REF" \
  --app-url "$AUTHORIZED_LEDGER_APP_URL" \
  --browser \
  --report .qa/hosted-production-acceptance.json
```

For loopback-only development QA, explicitly use `--local-runtime` and a
`http://127.0.0.1:<port>` application URL. This does not count as production QA.

## References

- https://vercel.com/docs/deployments/troubleshoot-project-collaboration
- https://vercel.com/docs/headers/request-headers
- https://supabase.com/docs/guides/auth/signout
- https://supabase.com/docs/guides/platform/ssl-enforcement
