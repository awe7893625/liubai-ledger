# Ledger daily-use completion batch — 2026-10-23

## Scope and release boundary

This batch builds on the accepted exploration release, not on the blocked
planning/preferences schema candidate. It introduces **no schema migration** and
never retries the previously safety-blocked M4 import or hosted DDL through
another command, connector, credential or process. The pending schema preflight
was checked read-only and still refused that candidate's deployment.

This is a complete delivery of the daily-use batch below, not a claim that every
private M4 feature, external-bank integration or native iPhone workflow is done.

## Implemented

### Mobile application shell

- Header, scrollable content, status message and navigation use separate grid
  rows. The bottom navigation no longer floats over the save button.
- Visual viewport handling responds to browser/toolbars and keyboard resizing;
  pinch zoom is not disabled. The optional keyboard state hides bottom navigation.
- Date controls, select controls, cards and transaction rows fit 320px screens.
- Summary and manual-first Shortcut banner are compact; existing Shortcut
  pairing, confirmation gates and downloads remain unchanged.
- All five navigation tabs, three settings sections and local appearance remain
  distinct. Navigation URL stores only tab/section, not financial search text.

### Transactions and analysis

- Date grouping with per-currency confirmed income/expense/refund totals.
- Newest, oldest and absolute-amount ordering. Amount ordering requires a single
  currency; no implicit FX comparisons or conversion.
- Month, text, account, category, status, source and currency filters; reset all.
- CSV exports exactly the filtered/sorted rows and retain formula protection.
- Six-month income/expense chart with an accessible exact-number table. Refunds
  and transfers are not misclassified, and no zero-record month is claimed to
  have complete bank coverage. Partial-month comparisons are labelled as recorded
  amounts, not a full-month forecast.
- Cloud load time and latest transaction date are separate. Historical imports
  carry an explicit note that refreshing does not sync a private legacy ledger.

### Payment/category and account settings

- Payment accounts and category management have their own settings section,
  separate from iPhone onboarding.
- Categories can be created and renamed using the existing table, with verified
  tenant ownership, duplicate-label checks, caps and stale-name conflict checks.
- Rename retains the category ID and existing transaction/budget references.
  Deletion is intentionally not exposed because safe migration of all dependent
  references is not yet implemented. This is not category-deletion parity.
- Existing device-local nickname/theme/currency settings now actually apply to
  the app immediately and on reload. They remain explicitly **device-local**;
  they do not replace or bypass the pending cloud preference migration.
- The button labelled local logout now uses local scope, not global logout.
- Optional other-browser logout is user-confirmed and explains access-token
  expiry and the separate revocation of Shortcut device tokens.
- Password reauthentication checks the returned user ID matches the account being
  updated. No password or auth token is written to reports.

## Verification

Unit/protocol coverage: 38 API tests and 25 ledger/view tests.
Isolated browser suite: 30 scenarios across Chromium 320/390/430/1280px and WebKit
390px. It intercepts all Auth/API requests and makes no real-user or map requests.
These tests are not physical iPhone/Apple Pay acceptance.

Retained failures were test-fixture issues: a synthetic write's timestamp did not
place it among the newest five rows, and Playwright's disabled check on an option
was replaced with checking the real disabled attribute. The application assertions
still verify the save result and the currency guard; no failed product behavior
was suppressed. Both initial reports are kept under the ignored QA directory.

The production suite uses two new **public signup** users, tests real category
persistence/isolation plus browser behavior, and cleans only their exact IDs.
Rate limits are not disabled and a failed public signup is not retried through
admin user creation. Record its outcome below before calling the release accepted.

Local evidence directory: `.qa/product-finish-20261023/`.
No user financial export, production token or environment credential is committed.

## References reviewed

- Supabase changelog (2026-10-23 check; currently surfaced through 2026-10-14).
- https://supabase.com/docs/reference/javascript/auth-updateuser
- https://supabase.com/docs/reference/javascript/auth-signout
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length

## Still outside this delivery

M4 incremental/continuous synchronization; hosted reserved/recurring-expense and
cloud-preference schema/application release; full generative AI and receipt
recognition; physical iPhone Shortcut/Wallet acceptance; restore-tested automated
backup operations; full billing-cycle/balance and category-deletion parity.

## Production receipt

- Deployed source: `7b62613` (including preceding reviewed checkpoint commits).
- Production: `dpl_ByknyXfchJuP7jaqCfNphfNUpExs`, READY, alias `app.blankspaces.uk`.
- 38 API tests + 25 ledger/view tests PASS; TypeScript, lint, audit, build and
  static release checks PASS.
- 30 isolated browser scenarios PASS across all five viewport/engine targets.
- 10 public production checks PASS: pages, health, unauthenticated rejection and
  byte-identical signed Shortcut downloads.
- Authenticated production acceptance **did not complete**: the first public
  signup received HTTP 429. The report is retained as FAIL, no alternate signup
  path was used, and the script did not proceed to protected category writes.
  Do not describe public smoke/fixture tests as successful hosted persistence QA.
- This release changes no existing private M4 data and performs no hosted DDL.

The same application changes were merged into the planning/preferences candidate
without removing its schema deployment guard. That candidate passed its 15
isolated planning/preference browser cases and full check-only release suite;
it was not deployed. It still needs an authorized hosted migration and actual
hosted persistence acceptance. No blocked operation was retried.

Evidence: `.qa/product-finish-20261023/public-smoke.json`,
`browser/report.json`, `production/report.json`, and `deployment.log`.
