# Transaction integrity and manual review — 2026-10-23

## Scope

Independent application/API release on the already deployed transaction schema.
No new table, migration, privileged import, M4 access, credential change, rate-limit
relaxation or alternate signup is part of this batch. The previously blocked M4
incremental import and planning/preferences DDL are not retried or substituted.
The pending candidate's schema deployment guard remains mandatory.

## Delivered behavior

- Web capture supports expense, income and refund. Refunds are positive receipts
  classified as refunds, not income. The existing per-account currency applies.
- The editor can explicitly classify a row as expense, income, refund or a transfer
  record. It preserves its original source and historical date/provenance identity.
- A transfer record marks only that row's in/out direction and excludes it from
  income/expense totals. It performs no bank transfer, creates no counterpart entry
  and does not establish double-entry balance/statement parity.
- A human can mark a row duplicate without deleting it, then restore confirmed
  status later. Reopening the editor preserves duplicate state. Missing Wallet
  fields can be retained/excluded without inventing a merchant or amount; restoring
  confirmed requires nonzero valid money and a merchant.
- The review panel identifies *candidates* only: identical calendar day, signed
  amount, currency, normalized merchant and explicit account across distinct
  sources. It never auto-merges or excludes. Normal repeat purchases remain a
  possible explanation. Same-source pairs and unknown-account pairs are ignored.
- Candidate display is bounded to 10 groups and 12 rows/group; further work uses
  normal transaction filters. Type filtering and a pending/error review shortcut
  complement the existing source/account/month/status filters.
- The API no longer returns a success receipt when an existing request ID is
  replayed with different meaningful content. Conflicting content returns 409;
  exact replays remain idempotent. An unspecified server timestamp is not compared.
- PATCH and DELETE guard their read snapshot's revision even for older clients
  that omit an expected version. Modern clients also pass their viewed revision.
  Revision timestamps advance by at least 1ms to avoid same-tick reuse.
- Frontend deletion includes the viewed revision, reports a conflict rather than
  claiming deletion, and does not populate a newly signed-in account's messages.

Classification reuses the existing `legacy_kind` field already used by imported
transactions. This does not repurpose transaction data to store pending cloud
preferences or recurring plans. No original transaction is rewritten by deployment.

## Verification

49 API/protocol tests and 34 presentation/model tests pass. They cover ownership,
exact retry/content collision, historical kinds, incomplete duplicate records,
stale delete/update, an injected intervening mutation and fractional-cent rejection.

20 new isolated browser scenarios pass across Chromium 320/390/1280px and WebKit
390px. They intercept every Auth/API request and never access a real account.
Existing 30 product browser scenarios also pass. Mobile screenshots were inspected
for field/row fit and non-overlapping bottom navigation. These are not physical
Apple Pay or authenticated production acceptance.

TypeScript, lint, build and the normal check-only release gate are required.
Production smoke/version/download results are appended after actual deployment.
No fresh public signup is attempted while the previous 429 acceptance gate remains
unresolved. The fixture reports are not labelled as hosted persistence evidence.

Evidence: ignored `.qa/transaction-integrity-20261023/` and its `browser/report.json`;
regression evidence also lives under `.qa/product-finish-20261023/browser/`.

## Reproduction

```sh
cd frontend
npm run test:cloud-api
npm run test:ledger-ui
npm run typecheck
npm run lint
npm run build
cd ..
# Start fixture-only Vite at loopback 5206, never a production session.
python3 scripts/check_transaction_integrity_ui.py
python3 scripts/check_product_finish_ui.py
bash scripts/release_public_beta.sh --check
```

## Outstanding project gates

M4's latest source is not synchronized by this release. Hosted planning/preferences
schema and deployment, authenticated hosted regression, native iPhone Shortcut and
Wallet acceptance, full generative receipt/AI support, complete balance/billing
workflows and restore-tested automated backups remain separate unfinished work.

References reviewed: Supabase changelog and update reference; PostgreSQL
transaction isolation documentation. Optimistic filtering is not a claim that
multiple independent writes run in a serializable transaction.

## Production receipt

- Deployed source `d8aa7c32dba1`; production `dpl_7e8oJFc5W19u3regxVj4mzT8AWMf`, READY.
- Public pages, health, exact revision metadata and both signed Shortcut hashes
  passed the release script checks. Existing Shortcut artifacts were unchanged.
- 49 API tests + 34 presentation tests, 20 new isolated browser checks and 30
  existing product browser checks PASS. A whitespace-only release check failure
  was corrected; the initial log was retained separately.
- No authenticated production financial write test was attempted; existing signup
  limits were respected. This is not complete hosted persistence acceptance.
- Changes were integrated into the pending planning/preferences branch. Its full
  check-only release and 15 planning/settings browser cases PASS; its schema
  deployment guard was preserved and that branch was not deployed.
- No M4 import, hosted migration or direct real-account transaction mutation was
  executed in this run. These remain outstanding, not implicitly completed.

Receipt: `.qa/transaction-integrity-20261023/release-receipt.json`.
