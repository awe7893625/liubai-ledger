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
| Map | Existing private implementation inspected | Tenant-scoped map and location consent UX not yet migrated |
| Assistant | No cloud AI claim | Tenant-scoped grounded answers, deterministic accounting, privacy-safe provider integration and cost controls |

## Release discipline

Each shipped feature requires code + protocol/unit gates + synthetic browser
acceptance + a confirmed production deployment. Build success alone is not a
phone acceptance. Public signup rate limits must remain active. Test users must
be isolated and cleaned by their exact generated identities. Real users' data
must not be used to fake acceptance or reset to create a clean test environment.

No feature is marked complete merely because its navigation item exists.
