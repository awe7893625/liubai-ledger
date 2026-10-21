# Ledger SaaS deployment receipt — 2026-10-21

## Release decision

**Not ready for public registration.** The Supabase Marketplace terms gate is
resolved. Hosted database provisioning and migration completed. A new Vercel
production deployment was explicitly BLOCKED by commit-author/team verification.
No access policy was relaxed, no author identity was rewritten, and no attempt
was made to publish via an alternative route around that block.

## Completed in this run

- Provisioned the requested Supabase **Free**, Tokyo/HND resource through the
  already linked isolated Vercel preview project.
- Connected production and preview environment variables without logging secrets.
- Applied `202609230001_cloud_v2.sql` and `202610210001_saas_core.sql` in a guarded
  transaction to the newly created, previously empty database.
- Connected to Postgres using TLS with CA and hostname verification (`verify-full`).
- Verified RLS enabled on all seven Ledger tables; anonymous reads and direct
  authenticated browser writes denied; service-role writes available.
- Added `scripts/e2e_cloud_hosted.py`, an opt-in acceptance runner using synthetic
  tenants only, with cleanup, explicit project identity checks and redacted output.
- Fixed the Vercel SPA fallback rewriting Vite module URLs to HTML in local dev.
  API 404 behavior stays fail-closed; module paths do not become SPA documents.

## What was actually tested

The accepted test path was **loopback Vercel API runtime + the real hosted Tokyo
Supabase database**, not a deployed Vercel production runtime. The runner records
`runtime=loopback_with_hosted_db` so these results cannot be mistaken for a live
production acceptance.

The final rerun passed 11 checks:

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
- `hosted-db-e2e-20261021-retest.json` (11 checks PASS)
- `cloud-synthetic-390.png` and `cloud-synthetic-1280.png`

## Remaining release gates

- Resolve commit-author access through the actual owner's verified Git/Vercel
  account connection. Vercel returned `TEAM_ACCESS_REQUIRED` and explicitly
  reported the commit author lacked deployment permission. Keep the PR draft.
- Redeploy with the new Supabase environment and run the same acceptance test
  against the actual HTTPS application URL **without** `--local-runtime`.
- Configure and verify public authentication delivery. Default Supabase SMTP is
  restricted to project-team addresses; synthetic admin-created users do not
  establish that arbitrary-user signup or magic-link email delivery works.
- Verify real iPhone Shortcut import, pairing and Wallet tap automation separately.
  API pairing simulation is not real-device acceptance.

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
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/platform/ssl-enforcement
