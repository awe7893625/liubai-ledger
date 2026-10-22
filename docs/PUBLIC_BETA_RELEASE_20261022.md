# Public Ledger Beta — 2026-10-22

Public entrypoint: https://app.blankspaces.uk/

## Supported scope

The public **web bookkeeping beta** supports Google or username/password login,
manual expenses/income, personal payment accounts, transaction history, monthly
views, search, filtered CSV export, and device management. This is not a promise
of complete bank synchronization or production-grade Apple Pay coverage.

Shortcut downloads and API pairing/ingestion are available as an advanced beta.
Physical iPhone installation, iCloud file permissions, native draft behaviour,
and Wallet NFC triggering are separate acceptance gates. Web or in-app Apple Pay
payments are not promised to fire a Wallet tap automation.

Current application limits remain 500 free accounts and 5 active devices per
account. Transaction lists load complete, tenant-scoped pages up to 50,000 rows;
if completeness cannot be established, the app fails visibly instead of showing
partial data as a complete financial total. Currency totals are separated; no
implicit exchange-rate conversion is performed.

## Changes in this release

- Clear stale account data immediately on authentication identity changes; ignore
  in-flight responses belonging to earlier identities/load generations.
- Distinguish loading failures from a genuinely empty ledger and retain last-known
  data with a visible warning.
- Use stable request IDs for same-form web retries; do not mark a committed write
  as failed just because refreshing the list failed.
- Add request timeouts, amount safety checks, and explicit expense/income selection.
- Calculate monthly confirmed-only totals using Taipei calendar dates. Historical
  dates are preserved; transfers and refunds are separated from income/expenses.
- Add month/search filters, CSV export with spreadsheet formula protection, and
  full list pagination instead of silently truncating at 1,000 rows.
- Restore mobile deletion controls and require confirmation.
- Reset scroll position when changing tabs; auto-dismiss ordinary success toasts.
- Add a concise beta/help/support section; keep setup instructions out of the daily
  bookkeeping flow.
- Replace the outdated deployment script with an app-only, project-guarded release
  gate. A normal app release never reapplies schema migrations or imports data.

## Reproducible verification

```sh
bash scripts/release_public_beta.sh --check
bash scripts/release_public_beta.sh --deploy
python3 scripts/e2e_public_launch.py \
  --app-url https://app.blankspaces.uk \
  --cleanup-env frontend/.env.saas.local \
  --report .qa/public-launch-20261022/production/report.json
```

The cleanup environment stays local and ignored. Only IDs created by the QA run
may be deleted, after exact synthetic-name/identity checks. The cleanup helper
verifies all rows for those IDs are gone. No real-user session is impersonated.

## Acceptance evidence

- 20 API/unit tests and 7 ledger presentation tests pass.
- TypeScript, ESLint, production build and static cloud gates pass.
- Production dependency audit reports zero known advisories at this check; this
  is not a guarantee of absence of security vulnerabilities.
- Pre-release local API + hosted DB: 11 checks pass, exact synthetic cleanup passes.
- The initial mobile test revealed hidden delete controls; the failure report is
  preserved and the successful rerun is stored separately.
- Public production verification is recorded separately in the ignored report
  above. It must be PASS before declaring this release accepted.

The browser checks exercise 390px and 1280px layouts, filtered export, lost POST
acknowledgement replay, deletion cancellation, interrupted reads, and account
switching. Protocol tests cover custom card configuration, one-time device
pairing, no-write probes, receipt-verified ingestion, and revocation. Signed
Shortcut downloads must match the release hashes.

## Operational boundaries

Application rollback uses a previous authorized Vercel deployment. No database
schema change is required by this release, so application rollback does not need
to restore a database. Never run the historical-import script during deployment.

There is not yet a claimed restore-tested, offsite automated database backup
program or 24/7 service-level guarantee. CSV exports provide user-controlled
copies, not a substitute for that operational work. Keep this labelled a free
public beta rather than an unlimited, fully automatic financial system.

Support and account deletion requests use the contact shown on /privacy and
/terms. Marketing must distinguish working web features from unverified native
Shortcut execution. Public release of the web beta does not require claiming
native Apple Pay acceptance.
