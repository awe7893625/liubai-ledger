# M4 → Cloud Ledger: consistent backup and offline snapshot

This is an **operator runbook**, not a command to change a hosted database. The
public SaaS remains a separate, multi-tenant database with its own RLS and OAuth
session boundary.

## Local source protection

Use a known, running M4 SQLite ledger. Never copy only the `.db` file while
the source has active WAL/SHM files. Use the SQLite online backup API.

`scripts/backup_m4_source.py` reads the source with `mode=ro`, takes an online
SQLite snapshot into memory and produces a gzip SQLite SQL dump in a pre-existing
backup directory with **0600** file permissions. A second in-memory SQLite restore
must pass `PRAGMA integrity_check`, exact transaction count, monthly counts and
a multi-table SHA-256 fingerprint before success is reported.

The backup uses the count *actually captured in the snapshot*, not a hardcoded
number. A new transaction arriving during backup must not cause false data loss,
double-entry, or a misleading count.

Use the following on the **authorized M4 host**, adjusting paths to its own
installation. Never run these commands in Vercel or an end-user browser.

```sh
python3 scripts/backup_m4_source.py \
  --source /path/to/ledger/backend/data/ledger.db \
  --output-dir /path/to/private/existing/backups

# Once the source and destination are verified, explicitly create a new copy.
python3 scripts/backup_m4_source.py \
  --source /path/to/ledger/backend/data/ledger.db \
  --output-dir /path/to/private/existing/backups --write
```

- The backup's `.sql.gz` is **sensitive private financial data**. Do not commit
  it, paste it in chats, upload it to a public storage bucket, or log its rows.
- Never alter a source's account/category IDs to match another database's names.
- Every output is create-only; existing backups are never overwritten.
- If copying a backup to another authorized computer later, use a separately
  approved secure transfer, verify its recorded SHA-256 and retain owner-only
  permissions. Do not infer that a snapshot may be transferred merely because
  local backup was authorized.

## Convert a verified backup to an offline reconciliation source

`scripts/prepare_m4_snapshot.py` validates the local archive and manifest,
loads the restored SQLite into memory and checks its owner, calendar dates,
transaction signs, sources, currencies and record uniqueness. Without
`--write`, it only reports counts and does not emit transaction details.

```sh
python3 scripts/prepare_m4_snapshot.py \
  --backup /private/ledger-cloud-source-DATE.sql.gz \
  --manifest /private/ledger-cloud-source-DATE.manifest.json \
  --source-instance-id m4-primary

# Write an explicit, local, private input for a separately authorized review.
python3 scripts/prepare_m4_snapshot.py \
  --backup /private/ledger-cloud-source-DATE.sql.gz \
  --manifest /private/ledger-cloud-source-DATE.manifest.json \
  --source-instance-id m4-primary \
  --write --output /private/source-snapshot-DATE.json
```

The generated JSON contains raw transactions. It must remain in an ignored,
non-public, owner-protected directory; it does not grant cloud access. The
offline reconciliation tool refuses stale snapshots (15-minute default), so a
new review after that window requires a **new authorized, consistent snapshot**.

## Verified M4 inventory — October 23, 2026 (read-only)

An existing owner-protected source backup on M4 was independently decompressed
and restored in memory. Its manifest and restored SQLite agree: **314
transactions**, dated through October 23, with 11 July, 119 August, 95 September
and 89 October rows. The archive was created at 21:09 Taiwan time, SHA-256
verified, permission mode 0600, integrity checks passed. A later read-only
source query still found 314; the original M4 database was not modified.

Against the **original 159-row source export**, full hashed-ID intersection
checks found 154 shared IDs, 5 old IDs absent from current M4 and 160
current M4 IDs absent from that export. The five historical missing IDs
all have **exact matching date/amount/currency/normalized-merchant
signatures under replacement IDs** in current M4 (four marked capture, one
email). Another two new IDs form a same-day/amount/merchant/account review
pair. These are **possible replacements/duplicates, not authorization to
exclude transactions**: legitimate same-day repeat purchases are possible.

Reference analysis (without exporting any names or IDs) showed six of six
original account IDs and 11 of 11 category IDs still exist in M4, and the
account descriptors/category slugs match. Some transaction-to-account,
category, normalized-merchant, description and note fields nevertheless
differ across the 154 shared rows. Never overwrite those differences
by rerunning the initial importer.

This makes **314 − 159 = 155** merely a net row-count difference. There
are 160 current source IDs absent from the old export; five of those
match prior purchase signatures and two are in one source-side
near-duplicate pair. The **actual cloud append list is unknown**, because
a fresh authorized cloud-side transaction comparison was rejected by the
tool safety check. The latest known cloud inventory was 159, not verified
anew during this batch. No cloud reads/writes, raw financial exports,
migration or public deployment are implied by these aggregate checks.

The offline planner now checks both acknowledged historical and current
cloud signatures and conservatively marks exact or weak historical
matches for review, even after a cloud merchant edit or deletion.
Confirmed `unknown`/unpaired `transfer` source kinds require explicit
review; malformed cloud currency/merchant types fail closed. If a
replacement source changes **two or more signature fields** (for example,
both merchant and amount), no deterministic match is guaranteed without
a stable issuer reference. Even an `append_candidate` may then be a
duplicate and must be individually reviewed against the live cloud
ledger and original receipts. **All append_candidate decisions are
review-only and never automatically executed.**

## Do not confuse counts with insertions

If the live source count increases by N and the old cloud count stays fixed,
the number of new source IDs is not necessarily N. Source-side deletions and
edits can coexist with new records, and different card statement imports can
represent the same purchase. The offline planner provides:

- `already_present`, `cloud_edited_preserve`, `cloud_deleted_preserve`
- `source_changed_review`, `both_changed_review`
- `append_candidate`, `unlinked_near_duplicate_review`
- `source_near_duplicate_review`, `ambiguous_cloud_date_review`
- `source_missing_preserve`, `both_absent_tombstone_preserve`

None of these classifications updates cloud data. A review requires a trusted,
previously acknowledged import baseline and **explicit source-ID → cloud-ID
maps** for accounts/categories; matching human-readable card names is unsafe.

## Production release gate remains separate

The planning/preferences candidate requires two exact migrations:

- `20261022101858_planning_and_preferences.sql`
- `20261023074854_planning_reference_ownership.sql`

Both are tested in a disposable, network-disabled PostgreSQL container. The
hosted guard must independently confirm migration hashes, validated
composite-owner references, RLS and browser privileges. **Do not apply either
migration if the hosted operation is still blocked by a safety check.**

After a formally approved hosted operation, the appropriate host operator must
perform the read-only guard, tenant-isolation persistence tests, and normal
release checks before deploying. No production import or hosted DDL is triggered
by the backup or snapshot tools.

## Tests

```sh
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
python3 scripts/check_planning_schema_local.py
bash scripts/release_public_beta.sh --check
```

These synthetic tests verify backup integrity, a live-growing source, private
file modes, exclusive creates, snapshot validation, deletion tombstones and
tenant constraints. They are **not** real-account hosted acceptance, an
authenticated cloud data read, or a native iPhone / Wallet tap test.
