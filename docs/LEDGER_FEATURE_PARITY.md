# Ledger private-to-SaaS feature parity

Updated: 2026-10-22. This is an acceptance inventory, not a completion percentage.

| Area | Implemented in SaaS | Still outside verified scope |
|---|---|---|
| Transactions | Tenant-owned create/edit/delete; historical calendar dates; month/account/category/status search; CSV; stale-edit conflicts; loading/error distinction | Full legacy grouping/sorting/batch tools and richer transaction detail parity |
| Monthly planning | Cloud-persisted monthly and currency plans, category limits, safety reserve, version conflicts, confirmed net-spending usage | Reserved expenses, recurring payment lifecycle and automatic rollover |
| Analysis | Monthly income/expense, category rankings, payment-account breakdown, average/max spending, selected-month drilldown | Complete trend/pace charts and all private ReflectPage views |
| Payment accounts | Per-user cards/cash/bank/wallet labels, exact Wallet aliases, create/edit | Full balance/statement/billing-cycle management |
| Shortcuts | Signed manual/Wallet downloads, per-device pairing, receipts, safe manual retry protocol, manual-first onboarding | Real iPhone action compatibility, native drafts, Wallet NFC acceptance; online Apple Pay not promised |
| Settings | Google/username login, password workflow, account/security view, settings sections | Cloud-synced preferences and complete account-management lifecycle; saved theme preference is not a completed dark theme |
| Private data | One historical import already completed | Newer live source identified; incremental backup/reconciliation blocked, not synchronized; no continuous sync claim |
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

## Release discipline

Each shipped feature requires code + protocol/unit gates + synthetic browser
acceptance + a confirmed production deployment. Build success alone is not a
phone acceptance. Public signup rate limits must remain active. Test users must
be isolated and cleaned by their exact generated identities. Real users' data
must not be used to fake acceptance or reset to create a clean test environment.

No feature is marked complete merely because its navigation item exists.
