# Shortcuts v2 / per-user payment settings — release receipt

Date: 2026-10-22 (Asia/Taipei)

## Delivered

- Public app: https://app.blankspaces.uk/connect?tab=settings
- Production deployment: `dpl_9TvJoisPCv3rafT5uP1JkCahhmc6` (READY).
- Feature commit: `e189d0c` on `chatgpt/ledger-saas-20261021`, including prior automatic checkpoint commits.
- Tenant-scoped payment account create/edit, exact Wallet aliases, independent choices for every user.
- Device-scoped configuration reads (labels/IDs only), manual expense/income ingest, probes, and receipt-confirmed result messages.
- Signed public automatic and manual shortcuts using the brand HTTPS API.
- No private M4 migration, no production user account modification, no new database schema required.

## Signed downloads verified against local release

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Liubai-Cloud.shortcut | 28995 | f9f9dd7baa914b101fa0cf9561f1380b1c2cf0fbc04535b435784e4d6a6280a4 |
| Liubai-Manual.shortcut | 33571 | f0aab0524770b9a28c9d6cbb4e6862a01f51ac15bb651e97f17c7a6acdcfd6f9 |

## Verified

- 20 automated API/unit tests pass; TypeScript, lint, build and static release gate pass.
- Brand-domain API health returns 200; unauthenticated payment settings access returns 401.
- Two newly created synthetic public users have independent payment lists.
- Cross-tenant account modification and foreign account/category use are rejected.
- Full card numbers and overlapping aliases are rejected.
- Device configuration exposes no transaction list/balance and cannot call user-management APIs.
- Four simultaneous identical manual requests create one expense and return the same transaction ID.
- Income/expense signs are correct; unknown Wallet cards are retained and explicitly flagged.
- Revoked device token cannot fetch configuration.
- Real production browser UI at 390px and 1280px: password sign-in, create payment account, manual download link; no page errors or horizontal overflow.

The run's 9 functional API/browser checks all passed. Its first cleanup attempt
failed with 401 because the test harness sent its browser-emulating User-Agent
with a server-only Supabase key. The initial report remains preserved as failed.
An authorized Node server SDK cleanup then verified the exact two synthetic
identities, deleted only those users, and confirmed zero remaining rows for those
IDs across profiles, accounts, categories, transactions, devices and wallet events.
The recovery receipt and combined acceptance report preserve this distinction.

The cleanup helper was subsequently refactored to use the server SDK rather than
browser-emulating HTTP headers. A further idempotence-check tool invocation was
blocked by the tool safety layer and was not retried through another mechanism.
This does not change the preceding successful deletion and zero-row verification.

Local ignored evidence:
- `.qa/shortcut-v2-unit-final.log`
- `.qa/shortcut-v2-production-deploy.log`
- `.qa/shortcut-v2-live/report.json` (initial cleanup failure preserved)
- `.qa/shortcut-v2-live/cleanup-recovery.json`
- `.qa/shortcut-v2-live/acceptance-final.json`
- `.qa/shortcut-v2-live/payment-settings-390.png`
- `.qa/shortcut-v2-live/payment-settings-1280.png`

## Not established by these tests

Signing and protocol/browser tests do not establish native iPhone execution.
Real iPhone import, Shortcuts action compatibility, iCloud file permissions,
pending-draft read/write and a real Wallet tap remain device acceptance gates.
The manual shortcut fetches configuration online before entry; it is not a fully
offline ledger. Its saved pending draft supports retry of an unconfirmed send.
The automatic Wallet shortcut has no persistent offline queue.

Each user must install/update shortcuts and configure their own personal Wallet
automation. Online Apple Pay payment completion is not promised to trigger a
Wallet tap automation. The separate 159-row private-history import is not part of
this release and was not executed.
