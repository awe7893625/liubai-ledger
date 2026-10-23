# Ledger release closure — 2026-10-23

## Scope

This application-only batch follows the accepted daily-use/exploration release.
It does not apply schema changes, import M4 financial data, relax authentication
limits, create alternate signup paths, or retry safety-blocked database writes.
The planning/preference candidate's read-only schema check was rerun and remains
not ready; its deployment gate must stay in place.

## Delivered implementation

- Existing auth rate-limit thresholds and accounting remain unchanged. A denied
  request returns a bounded `Retry-After` header and `retry_after_seconds` field.
- The retry time is based on the attempt that must expire for another request to
  fit within the existing window, not just the oldest attempt. If that lookup
  fails, the full configured window is returned rather than failing open.
- The browser shows a localized explanation, remaining wait and approximate local
  retry time. It prevents repeated in-flight submissions and does not automatically
  resubmit credentials when the countdown ends.
- Only per-route expiry timestamps are stored in sessionStorage. Passwords,
  usernames, recovery codes, tokens and transaction data are not stored there.
  Backend rate limits remain authoritative if browser storage is unavailable.
- Signup, login, recovery and Google callbacks have separate cooldown state.
  Existing valid login remains a distinct supported operation, not a test bypass.
- General settings include a user-initiated, no-write service check and a support
  diagnostic containing only build identity, service state, check time and page
  pathname. Health success is explicitly not private-source or Wallet sync proof.
- Build produces non-secret `/version.json`; HTTP caching is disabled. Releases
  now check the public revision matches the reviewed commit and verify unchanged
  signed Shortcut downloads. No additional Vercel function is introduced.

## Verification

- 42 API tests and 28 presentation tests PASS.
- 16 new isolated browser scenarios PASS: Chromium 320/390/1280px and WebKit 390px.
- 30 existing product browser scenarios PASS across five viewport/engine targets.
- New browser tests intercept ALL Auth/API requests. Countdown advancement uses
  only the isolated browser's clock; no hosted attempt counters are changed.
- UI screenshots inspected for mobile cooldown and diagnostic layout.
- TypeScript, ESLint and production build PASS.

The authenticated public-site suite was attempted once through normal public
signup and returned HTTP 429 before any account was created. Its FAIL report is
retained at `.qa/completion-20261023/production/report.json`. It was not retried
with an alternate IP, token, admin-created account, connector or quota change.
These fixture passes therefore do not claim authenticated production acceptance.

## Release evidence

Deployment revision, public route checks, actual 429 header/body verification
(if an ordinary authorized check is performed), and build/download matching are
recorded separately after deployment. Never treat a READY deployment or successful
health request as native iPhone, full registration or full feature-parity proof.

## Outstanding independent gates

1. **M4 incremental sync:** previously identified latest source is the private M4
   API, not the older export host. The prior 309-row inventory was observed on
   2026-10-22; it is not asserted as today's count. Authorized backup/reconciliation
   and import remain incomplete; no continuous synchronization is claimed.
2. **Hosted planning/preferences:** `20261022101858_planning_and_preferences.sql`
   and its guarded candidate remain pending authorized schema application, hosted
   persistence/isolation acceptance and deployment. No alternative storage method
   is used to evade the blocked operation.
3. **Physical iPhone/Wallet:** real import, native draft/file permissions and NFC
   transaction triggers still require real-device acceptance.
4. **Full M4 parity:** generative AI/receipt recognition, complete statement/balance
   workflows and restore-tested automated backup operations remain outside the
   verified public beta scope.

## References reviewed

- https://supabase.com/changelog.md
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://playwright.dev/python/docs/clock

## Reproduction

```sh
cd frontend
npm run test:cloud-api
npm run test:ledger-ui
npm run typecheck
npm run lint
npm run build
cd ..
# Start Vite on loopback 5206 with fixture-only Supabase config.
python3 scripts/check_auth_diagnostics_ui.py
python3 scripts/check_product_finish_ui.py
bash scripts/release_public_beta.sh --check
```

The pending combined branch must retain its separate schema guard when merging
this batch. The public release branch contains no dependency on pending tables.

## Accepted public release receipt

- Application source: `2eb195af2b6b` including its tested checkpoint commits.
- Production deployment: `dpl_H9FnVmGni2csDThxtCJGp9z5KbvU`, READY.
- The application-only release script passed checks for public pages, health,
  exact published source revision, no-store build metadata, and byte-identical
  signed manual/Wallet Shortcut downloads.
- Independent real-browser public login checks passed at 390px and 1280px;
  Google button rendered with no JavaScript errors or horizontal overflow.
  These checks performed no signups, logins or protected-data writes.
- A subsequent default urllib request to `/version.json` received HTTP 403.
  It was not retried with changed headers, another origin or credentials.
  The preceding successful release-script evidence is retained separately.
- Authenticated production acceptance remains incomplete: its single ordinary
  signup attempt received HTTP 429. Fixture passes are not substituted for it.
- The combined planning/preferences candidate was merged without removing its
  schema guard; check-only release and 15 isolated planning/settings scenarios
  passed. That candidate was not deployed and no blocked hosted DDL or M4 sync
  operation was performed.

Evidence: `.qa/completion-20261023/deployment.log`, `public-receipt.json`,
`browser/report.json`, `production/report.json`; existing regression evidence
under `.qa/product-finish-20261023/browser/`.
