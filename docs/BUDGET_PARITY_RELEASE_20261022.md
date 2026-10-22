# Monthly budgets and transaction-edit parity — 2026-10-22

## Scope

This release adds durable monthly/currency budgets, optional per-category limits,
a safety reserve, and confirmed-transaction budget usage. It also repairs the
transaction editor and aligns analysis with the selected transaction month.

This is a bounded release, not a declaration that the original private Ledger
has complete SaaS feature parity. Remaining modules include reserved/recurring
payment workflows, richer trends, map, AI assistant, real device Shortcut
acceptance, account-preference synchronization and ongoing private-source sync.

## Architecture

- `ledger_budgets`: primary key `(user_id, period_month, currency)`; versioned
  writes; minor-unit integer amounts; browser SELECT is owner-only through RLS.
- Anonymous reads and direct authenticated writes are revoked. Server handlers
  validate user sessions, category ownership, total limits and reserve bounds.
- `GET/PUT/DELETE /api/v2/budgets` is routed to the existing bootstrap runtime with
  `resource=budgets`; handler logic remains isolated in `_shared/budget-handler.js`.
  No extra Vercel Function or paid resource was created.
- Optimistic versions prevent silent cross-device lost updates. Stale saves or
  deletes return 409; users retain their draft and can explicitly reload.
- Currency totals are never mixed or converted. Confirmed expenses minus refunds
  consume budget; transfers, unconfirmed rows and other currencies are excluded.
- Daily allowance is a deterministic remaining-budget/day calculation, not a
  forecast or investment recommendation.

## Transaction editor repair

The previous client-side amount regex contained doubled escapes and rejected
valid input. A dedicated native dialog replaces it, with keyboard focus, Escape,
body scroll locking, inline errors and date editing. Imported calendar-only rows
keep calendar dates; timestamped rows retain timestamps. Source and imported kind
are not silently rewritten. Same-currency account validation and optional stale
revision checks are enforced by the server, not only by the UI.

Selecting a different account clears filters, editor drafts, month and currency
state. A slow request from the previous user cannot populate the new session.
Transaction names now open the editor; an extra narrow-row edit column was
removed. Month analysis and budget views use the selected list month.

## Verification and limits

- Unit gates: 33 API tests and 10 calculation/UI helper tests.
- Synthetic fixture setup uses Auth admin only to create two isolated test users.
  This does **not** count as public signup validation and does not disable or
  bypass signup/login rate limits. Product requests then use their real user JWTs.
- The acceptance runner tests version conflicts, RLS, direct-write denial,
  foreign categories, stale transaction edits, cross-account switches and real
  390px/1280px forms. Exact synthetic identities and their rows are removed.
- Initial test reports remain preserved: one assertion incorrectly expected a
  budget amount to occur only once; another exposed retained month state on
  account switch. Their corrections are exercised in a separate final rerun.
- Supabase MCP security-advisor access for the Vercel-created project is not
  authorized by the current connector. Do not claim a platform-advisor pass.
  Schema privileges and RLS are tested directly with synthetic identities.

Local ignored evidence: `.qa/budget-parity-20261022/`.

```sh
bash scripts/release_public_beta.sh --check
python3 scripts/e2e_budget_parity.py \
  --app-url https://app.blankspaces.uk \
  --env-file frontend/.env.saas.local \
  --report .qa/budget-parity-20261022/production/report.json
```

The sole new migration is `20261022092623_monthly_budgets.sql`, generated with the
Supabase CLI and applied via the project-identity/TLS/hash-guarded migration
runner using `--only`. Existing transaction rows are not rewritten by this
migration. App rollback can leave the additional table in place.

## Private-source freshness is a separate gate

The live private application's API prefix was found to differ from the previous
export source. A metadata inventory demonstrated newer data exists. A subsequent
source backup/reconciliation tool operation was safety-blocked; no alternate
route was attempted and no incremental import is included in this release.
Do not describe discovery of a newer source as completed synchronization.
