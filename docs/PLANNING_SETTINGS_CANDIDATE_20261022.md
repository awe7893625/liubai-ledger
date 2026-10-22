# Planning and cloud preferences candidate — 2026-10-22

## Release decision

**Not deployed. Hosted schema migration is blocked by a tool safety check.**
The single production migration/baseline invocation was rejected; it was not
retried with another connector, credential, command shape or transport. No M4
import/sync was attempted. The existing public deployment remains the previously
accepted budget/editor release. Do not describe this candidate as available to
public users until the additive migration and authenticated production acceptance
have both completed through an authorized workflow.

## Implemented candidate

### General settings that take effect

- Per-user cloud preference record: display nickname, light/dark/system theme,
  default overview currency and web-capture account/category.
- Successful save updates the current app immediately; another device refreshes
  to obtain the stored preferences. This is not realtime push synchronization.
- Exact session ownership and reference validation; one user's account/category
  cannot be assigned to another user's defaults.
- Versioned writes reject stale edits from a second device.
- Theme uses the existing Ledger design tokens; hard-coded newer surfaces are
  brought onto those tokens. Secondary-button contrast and native control sizing
  are checked in WebKit and Chromium.
- No currency conversion, Google account rename, account merge or automatic
  migration of old localStorage preferences is implied.

### Reserved and recurring expenses

- One-time or monthly plans, start/end month, planned day, currency and optional
  payment account/category. Dates absent in a month clamp to month end.
- Monthly occurrences are projected on read; no cron, bank action or transaction
  insert is required simply to see the next month.
- Explicitly link an existing, confirmed, same-month/currency expense to mark a
  period paid. Actual amounts may differ from the plan; actual ledger spending
  stays authoritative. Partial installments require separate plan items.
- One transaction may satisfy at most one plan occurrence. Linking never creates
  another transaction.
- Skip only one period, reopen its reserve, pause/resume the plan, and edit the
  recurring rule. Editing the rule recomputes its displayed projections, not the
  real transaction history.
- Deleting or invalidating a linked payment restores the pending reserve and
  flags it for review. No automatic rematching is performed.
- Budget available-to-use amount deducts safety buffer and outstanding planned
  expenses; actual confirmed spending is never counted twice.
- Future/past overview months are available even before those months have real
  transactions. There is a 500-plan application cap.

## Schema and application delivery

Generated with the Supabase migration CLI:
`20261022101858_planning_and_preferences.sql`.

Three additive tables: `ledger_preferences`, `ledger_scheduled_expenses`, and
`ledger_scheduled_receipts`. All enable RLS, grant authenticated own-row reads,
reject anonymous reads and direct browser writes, and keep server-mediated
mutations. No existing transaction data is changed by the migration.

Routes `/api/v2/preferences` and `/api/v2/planning` share the existing bootstrap
function entrypoint, like budgets, so this feature does not add deployed Vercel
function entries. The normal deployment script now runs a **read-only schema
preflight** before deploying. Missing tables, migration hash mismatch or unsafe
grants refuse deployment. This guard is not an authorization workaround.

## Evidence and limits

Final isolated acceptance: **41 API tests + 10 ledger presentation tests PASS**;
**7 PostgreSQL schema/RLS checks PASS**; **15 browser scenarios PASS**, no skipped
browser engines. TypeScript, lint, build, static gates and the application's
check-only release command also pass. The button contrast check verifies a ratio
of at least 4.5:1; a transition-caused temporary contrast failure was corrected
and its earlier failure report was retained.

These results do not establish hosted persistence or authenticated production
acceptance. No production deploy was performed for this candidate.

- API unit/protocol tests use explicit fixture Auth and in-memory REST responses.
- Database constraints and RLS are independently tested in a new PostgreSQL
  container with `--network none`, no external credentials, no volumes from the
  private ledger, and cleanup in `finally`.
- Browser tests intercept all API/Auth/data requests. No real user session is
  impersonated and no real ledger is read by those tests.
- Browser targets: Chromium 390px/1280px and WebKit 390px. WebKit headless is not a
  physical iPhone acceptance.
- The initial SQL fixture run used the wrong local schema owner and was cleaned;
  the successful rerun used the isolated image's database administrator.
- The initial browser run exposed ambiguous form labeling; the failure report is
  retained separately and the labels were corrected.

Ignored local evidence under `.qa/planning-settings-20261022/`:
`api-all.log`, `isolated-schema.log`, `isolated-schema-retest.log`, `ui/report.json`,
`ui/report-initial-failure.json`, `ui-final.log`, and rendered fixture screenshots.
No real-account export, OAuth token, password or connection secret is committed.

## Reproduction without production access

```sh
cd frontend
npm run test:cloud-api
npm run test:ledger-ui
npm run typecheck
npm run lint
npm run build
cd ..
python3 scripts/check_planning_schema_local.py
# Start Vite with fixture.supabase.invalid, fixture-publishable-key and port 5204.
python3 scripts/check_planning_settings_ui.py
```

## Remaining release gates

Authorized hosted migration, actual hosted persistence/tenant-isolation checks,
public deployment, and authenticated production smoke tests. M4 incremental
synchronization, maps, AI assistance and physical iPhone Wallet acceptance remain
separate unfinished work; this candidate does not establish any of them.
