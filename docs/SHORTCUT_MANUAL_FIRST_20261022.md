# Manual-first Shortcut onboarding — 2026-10-22

## Product path

Public entry: `https://app.blankspaces.uk/connect?tab=settings`.

1. Install the v3 **留白手動記帳** Shortcut and pair it from the website.
2. Run the manual Shortcut and save a real transaction. A 1 TWD test entry is
   permitted but is a real ledger entry, not a no-write simulation.
3. The server confirms a processed, device-scoped manual receipt. The website then
   exposes the automatic Shortcut download and Apple Pay setup instructions.
4. Configure the iPhone's Wallet transaction automation and verify on a subsequent
   normal contactless purchase. Website or in-app Apple Pay is not guaranteed to
   fire the Wallet tap trigger.

Manual and automatic Shortcuts share the existing device credential file.
Automatic v2 pairing remains compatible; v3 Manual additionally accepts the same
one-time pairing ticket. The website now launches Manual for pairing, so installing
Automatic is no longer a prerequisite for the manual test.

## Trust and state boundaries

- `GET /api/v2/devices?onboarding=1` requires a verified user session. Both device
  and ingestion reads are explicitly constrained to that user.
- Only a server-owned processed event with `payload.source=manual` from that active
  device qualifies. Browser manual entries, probes, callbacks and UI checkboxes do not.
- Verification is per device, not per tenant. Revoked devices are omitted. A new
  device must qualify independently.
- The processed event survives deletion of its test transaction, preserving the
  successful path without forcing a fake expense to remain in the ledger.
- No amount, merchant, raw payload or token is included in the progress response.
- A Wallet receipt is evidence of server ingestion, **not cryptographic evidence
  that iOS itself fired an NFC trigger**. `ios_trigger_attested` is always false.
- Pending fields or unmatched cards remain review states, not a fully successful
  automatic setup claim.
- UI progress refreshes on focus/foreground return and explicitly on request.
  Optional polling is foreground-only and capped at 90 seconds. Errors disable
  the next-step guide instead of claiming new success from stale data.
- The guide is an onboarding gate only; existing ingest clients are not blocked.
- No new schema migration, historical import or real-user mutation is part of this change.

## Verification evidence

- 27 API/unit tests pass, including actual devices-handler invocation against a
  mocked Supabase boundary, owner scoping, deleted test entries, revocation and
  the distinction between server receipts and native iOS attestation.
- 7 existing ledger data tests pass; TypeScript/lint/build/static gates pass.
- 8 isolated browser checks pass at 390px and 1280px: progress gates, per-device
  selection, error recovery, Wallet review state, revocation and home layout.
  All API/Auth/data responses in these browser checks are fixtures. They are NOT
  live production E2E or physical iPhone testing.
- A real API E2E attempt was stopped by the configured signup limit (HTTP 429).
  The limit was not relaxed and the attempt was not repeated through another
  origin/IP/privilege path. The one account created before the limit was reached
  was deleted and its scoped rows verified absent. The failed report is retained.
- Both v3 files are Apple-signed. Signing does not establish native execution.
- Real iPhone import, pairing/file permissions and Wallet tap remain user-device
  acceptance steps; this release supplies the measurement and onboarding path.

Private evidence lives under `.qa/shortcut-onboarding-20261022/`, ignored by Git:
`api-tests.log`, `ui-tests.log`, `release-check.log`, `local/report.json` (429),
`isolated-ui/report.json`, and synthetic screenshot files.

## Published release

- Source revision: `0fde4ea` (including its preceding tested checkpoint).
- Production deployment: `dpl_B7bQWTQHNuEHffxRPLFM89P9si4P`, READY, aliased to
  `https://app.blankspaces.uk`.
- Public `/connect`, settings entry and health returned HTTP 200. Unauthenticated
  onboarding requests returned 401.
- Published manual file: 34,891 bytes,
  SHA-256 `55ee926698b5213efd9b23af2d81608e898b93843ef966f6b7d07526b50d6d03`.
- Published automatic file: 29,030 bytes,
  SHA-256 `72cc52c3d44a1a634b888482ee217857a8a5324ed507e30c3e6ad2eb26f184e8`.
- These public smoke checks are not a replacement for the rate-limited live
  authenticated E2E attempt or physical iPhone acceptance.

## Native instructions checked against Apple

- https://support.apple.com/zh-tw/guide/shortcuts/apd65c67538a/ios
- https://support.apple.com/en-euro/guide/shortcuts/apdfbdbd7123/10.0/ios/27
- https://support.apple.com/en-euro/guide/shortcuts/apd602971e63/ios

For newer interfaces, create a separate `Apple Pay 入口` Shortcut with the Wallet
trigger and Dictionary + Run Shortcut actions. Do not make `留白自動記帳` invoke
itself. Older interfaces can place those actions in a personal automation.
