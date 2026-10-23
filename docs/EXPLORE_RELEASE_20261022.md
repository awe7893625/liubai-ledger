# Ledger exploration — independently deployable web slice

## Scope and separation

This branch is based on the actual deployed budget/editor revision `d65559a`,
verified via the live Vercel alias, rather than the planning/preferences candidate
`9974eda`. The latter's migration remains blocked and is not retried, rewritten,
or routed through another connector. Its code and schema guard remain intact in
its own worktree. This independent release does not change the database, backend
handlers, authentication policy, signup limits, or M4 import process.

Feature worktree: `ledger-explore-20261022`; branch:
`chatgpt/ledger-explore-20261022`. Public entry: `/connect?tab=explore`.

## User features

- Fifth navigation tab **探索**, containing **帳本查詢** and **消費地點**.
- Deterministic ledger questions: selected/current/previous month, today/yesterday,
  current/previous calendar week, explicit YYYY-MM or YYYY-MM-DD, exact account or
  category names, and merchant expense rankings. Unknown or ambiguous wording is
  rejected, not guessed.
- Evidence list shows exactly the confirmed rows used by a calculation. Transfers,
  pending/invalid records and other currencies are excluded; income and refunds
  are separate. Old `legacy_date` values remain original purchase dates.
- Latest loaded transaction date is visible. An empty result explicitly does NOT
  establish no real-world spending or completed bank synchronization.
- Short text such as `午餐 120` prepares a draft, not a transaction. Amount/account/
  category/date parsing is deliberately narrow. The user must confirm the normal
  bookkeeping form before its existing authenticated API can write anything.
- A draft's missing time is visibly prefilled to noon for manual confirmation.
  No fuzzy bank-name guesses or automatic account assignment occurs.
- Location view reads only explicitly stored coordinates from existing transaction
  notes, using the legacy map marker format or strict JSON latitude/longitude.
  It does not ask the browser for location, infer addresses, or add coordinates.
- Map tiles load only after explicit per-view consent; labels and amounts remain
  local. OpenStreetMap receives IP/viewport requests, not transaction descriptions.
  Closing the map stops new requests; prior requests cannot be recalled.
- Leaflet markers use React text, not merchant-provided HTML. Coordinate bounds,
  malformed JSON and nulls are validated. No background tile downloading or
  geocoding. Attribution stays visible; a location list works without map consent.
- Safari native select controls have a 44px usable height. Draft confirmation is
  inline in the capture form instead of a persistent toast covering other pages.

This is not a generative AI assistant, not a receipt OCR implementation, and not
new GPS ingestion for the Shortcuts. Those broader parity items remain unfinished.

## Verification

`npm run test:ledger-ui` includes 10 dedicated exploration tests in addition to
10 prior presentation/budget tests. Existing 33 API tests are unchanged. Browser
QA uses Chromium 390/1280 and WebKit 390, with API/Auth/tile fixtures intercepted;
no real user is impersonated and no automated OSM tile traffic occurs.

`check_explore_ui.py` checks exact totals/evidence, unrecognized queries, draft
non-write behavior, explicit map consent, attribution, map teardown, overflow,
JS exceptions and signout clearing. Initial Leaflet unmount error was corrected
by disabling transition animations; its failure report is preserved.

`e2e_explore_hosted.py` is a separate production test: one public synthetic signup,
three exact synthetic transactions, real username login and tenant reads. It
verifies queries, drafts, map eligibility and unchanged row count, then cleans
only its generated user ID after checking the expected synthetic username.
It must not be called a successful public acceptance unless its saved report is
PASS and cleanup is verified. It does not test Google OAuth again or real iPhone.

## Commands

```sh
cd frontend
npm ci
npm run typecheck
npm run lint
npm run test:ledger-ui
npm run test:cloud-api
npm run build
cd ..
# Vite fixture environment on loopback :5206 only, then:
python3 scripts/check_explore_ui.py
# After authorized app-only deployment:
python3 scripts/e2e_explore_hosted.py \
  --cleanup-env /absolute/path/to/ignored/frontend/.env.saas.local \
  --report .qa/explore-release/hosted/report.json
```

All credentials remain in ignored local environment files; test outputs do not
log tokens or passwords. No private data synchronization was attempted here.
Any future planning deployment must merge this release so it does not discard
new public features, and still pass its own separate schema guard.

## Final acceptance

Production deployment `dpl_Hb5rycrT3o3na5UCxvNh3YC7tqLh` is READY at the brand
domain, deployed source `2f988c5`. The application-only diff contains no schema
or backend changes relative to `d65559a`.

- 20 presentation tests + 33 existing API tests PASS.
- Nine isolated browser scenarios PASS (Chromium 390/1280, WebKit 390).
- Five real hosted checks PASS, using one public synthetic signup and three
  synthetic transactions. Query totals/evidence, non-writing draft handoff,
  stored-location parsing, map consent, mobile layout and logout were verified.
- Cleanup verified: synthetic user deleted, zero remaining scoped rows.
- Production screenshots contain only synthetic data. Test tiles were local
  fixtures, not automated OpenStreetMap requests.
- Pending planning/preferences work has not been deployed or migrated. Original
  user data, M4 synchronization and native iPhone execution were not touched.

Reports: `.qa/explore-release/browser/report.json` and
`.qa/explore-release/hosted/report.json` (ignored local verification evidence).

## Primary implementation references

- https://react-leaflet.js.org/docs/v4/api-map/
- https://operations.osmfoundation.org/policies/tiles/
- https://supabase.com/docs/guides/database/postgres/row-level-security
