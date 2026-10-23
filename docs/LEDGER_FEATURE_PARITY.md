# Ledger private-to-SaaS feature parity

Updated: 2026-10-23. This is an acceptance inventory, not a completion percentage. The Luna/core-closure task changed only the pending branch; it did not deploy or synchronize live data.

| Area | Implemented in SaaS | Still outside verified scope |
|---|---|---|
| Transactions | Tenant-owned create/edit/delete; dates; grouped/sorted filtered history and CSV; refund/transfer kinds; stale-edit/delete conflicts; manual duplicate review; loading/error distinction | Complete batch tools, full balanced-transfer/statement workflows and richer detail parity |
| Monthly planning | Cloud-persisted monthly and currency plans, category limits, safety reserve, version conflicts, confirmed net-spending usage | Reserved expenses, recurring payment lifecycle and automatic rollover |
| Analysis | Monthly totals, category/account breakdowns, average/max spending, selected-month drilldown and six-month trend with exact-number table | Complete pace/forecast views and all private ReflectPage workflows |
| Payment accounts | Per-user cards/cash/bank/wallet labels, exact Wallet aliases, create/edit | Full balance/statement/billing-cycle management |
| Shortcuts | Signed manual/Wallet downloads, per-device pairing, receipts, safe manual retry protocol, manual-first onboarding | Real iPhone action compatibility, native drafts, Wallet NFC acceptance; online Apple Pay not promised |
| Settings | Google/username login, password workflow, account/security view, working device-local theme/name/currency, local/other-browser logout, service diagnostics | Cloud-synced preferences and complete account-management lifecycle remain pending |
| Private data | One historical import completed; offline reconciliation contract now source-reviewed with synthetic edit/delete/duplicate tests | No new authorized live snapshots/import; no production incremental executor or continuous sync claim |
| Map | Shipped exploration slice: existing note coordinates, month/day/currency filter, consent-gated OpenStreetMap viewport, no inferred locations | New GPS ingestion, native Shortcut position capture and full private-map parity remain unfinished |
| Assistant | Shipped deterministic ledger query/evidence and short-text draft handoff; no automatic writes or external AI | Generative AI, receipt OCR, voice workflow and broader original-assistant parity remain unfinished |

## Independently shipped exploration

The production branch `chatgpt/ledger-explore-20261022` ships from the previously
accepted budget/editor base without any new schema or server changes. It is
merged into this candidate to prevent a future release from dropping those
features. Deployment `dpl_Hb5rycrT3o3na5UCxvNh3YC7tqLh` / source `2f988c5` passed
53 unit tests, nine isolated browser scenarios and five synthetic hosted checks;
its exact test account was deleted. This does not unblock the candidate migration.

## New candidate, not deployed

The 2026-10-22 planning/settings candidate adds one-time/monthly reservations,
explicit links to existing payments, skip/pause lifecycle, budget deduction, and
cloud-synced nickname/theme/default account/category. This is **not part of the
live-site feature claim above**: its hosted migration invocation was safety-blocked
and not retried. See `PLANNING_SETTINGS_CANDIDATE_20261022.md` for isolated API,
PostgreSQL and browser evidence plus the production release gates.

## Codex Luna core review — pending branch only

Three bounded read-only Luna reviews closed source-level issues in offline
reconciliation and planning reference ownership. The new follow-up migration
`20261023074854_planning_reference_ownership.sql` adds five tenant-composite FKs.
Both pending migration hashes are now mandatory in the release preflight.
28 offline/guard tests and 16 isolated PostgreSQL checks passed, including an
unpatched negative control. No previously blocked action was delegated or retried.
See `LUNA_CORE_RECONCILIATION_20261023.md` for input contracts, reviewer findings,
actual test evidence and the remaining owner/host approval gates.

## Release discipline

Each shipped feature requires code + protocol/unit gates + synthetic browser
acceptance + a confirmed production deployment. Build success alone is not a
phone acceptance. Public signup rate limits must remain active. Test users must
be isolated and cleaned by their exact generated identities. Real users' data
must not be used to fake acceptance or reset to create a clean test environment.

No feature is marked complete merely because its navigation item exists.
