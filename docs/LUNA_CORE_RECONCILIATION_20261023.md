# Ledger core closure with Codex Luna — 2026-10-23

## Status: source fixes verified; NOT deployed / NOT synchronized

This work is deliberately focused on the two unresolved core paths: incremental
M4 reconciliation and the guarded planning/preferences release. It adds no UI
feature and performs no hosted DDL, auth mutation, M4 request/export or import.
Prior tool safety blocks remain in force. Delegating a review to Luna is not a
way to obtain production permissions or bypass a safety decision.

Writer/integrator: this ChatGPT session. Independent reviewer: Codex CLI model
`gpt-6-luna`, explicitly read-only sandbox, three bounded runs. Each run completed
with exit code 0. Reviewer reports and process receipts are retained in the
ignored `.qa/luna-closure-20261023/` directory. Luna did not read credentials or
private financial exports and was not tasked with executing production actions.

## Findings resolved in source

1. The legacy first-import script is not a safe ongoing-sync policy. Its exact
   full-source reconciliation and name-based account/category upserts can conflict
   with subsequent cloud edits/deletions. It does not report all changed fields.
   The new offline planner is a separate review tool, not a replacement write path.
2. Five optional planning/preference references originally depended only on API
   ownership checks. The generated follow-up migration binds each reference to
   `user_id` as a composite foreign key. Deletion clears only the optional ID,
   never the owning user's ID. Original migration contents/hash remain unchanged.
3. Luna's second review found a potential false append when `legacy_date` differs
   from the timestamp's Taipei calendar day. The planner now checks both days and
   reports the ambiguity rather than selecting an append candidate.
4. Deleted baseline records absent on both sides now remain explicit tombstones
   in the review manifest. Their later reappearance in M4 does not resurrect them.

Review clarification: a clean superset export CAN pass the old importer if no
other records changed. It is the unsafe reconciliation policy after divergence,
not merely a larger row count, that makes it unsuitable for routine sync.

Final Luna source-review conclusion: no remaining P0/P1 risks identified in the
requested offline planner/constraint files; both second-review findings closed.
This is a bounded source review, not proof of hosted persistence or authorization.

## Offline reconciliation contract

Entry point: `scripts/ledger_reconcile.py`. Python standard library only. No
network, database driver, credential loading, SQL generation or apply option.
It consumes four previously authorized local documents:

- **source**: schema, source_instance_id, captured_at, transactions,
  funding_accounts and categories.
- **cloud**: schema, immutable target_user_id/project_ref, captured_at,
  transactions, accounts and categories; ALL rows must belong to that user.
- **baseline**: immutable acknowledged-import receipts with source_at_import and
  cloud_at_import, retained separately from cascading cloud provenance records.
  Contains the original membership even if a transaction is later deleted.
- **binding**: explicit source lineage and immutable target identity, baseline
  digest, and reviewed one-to-one source-ID → cloud-ID account/category maps.

All documents use schema `ledger-offline-reconciliation-v1`. Source/cloud snapshots
must be fresh within 15 minutes and timezone-aware. Names are not identities.
The binding's hash checks consistency; it is NOT a cryptographic authorization
certificate and must be approved by the real host owner workflow.

Never reconstruct the baseline from the current edited cloud state and call it
an acknowledged historical baseline. If original evidence is incomplete, stop for
manual reconciliation rather than guessing which rows were deleted or changed.

Manifest decisions include append_candidate, already_present,
cloud_edited_preserve, cloud_deleted_preserve, source_changed_review,
both_changed_review, unlinked_near_duplicate_review, source_near_duplicate_review,
ambiguous_cloud_date_review, unmapped_reference_review, source_missing_preserve,
both_absent_tombstone_preserve and identity/currency conflicts.

Reports contain counts, field names and digests, not merchants, notes, raw user
IDs, account IDs or monetary values. Output creation is exclusive and mode 0600;
an existing report is not overwritten. Inputs are not modified.

**An append_candidate is not permission to insert.** Every manifest sets
apply_authorized=false, has empty write/delete operation lists, and requires a
new authorized consistent read before any separately reviewed future executor.
The tool never renames accounts/categories, updates cloud transactions, deletes
rows, suppresses near-duplicates automatically, or schedules continuing sync.

Example for an authorized operator with already approved snapshot files:

```sh
python3 scripts/ledger_reconcile.py \
  --source <source-snapshot.json> --cloud <cloud-snapshot.json> \
  --baseline <acknowledged-baseline.json> --binding <reviewed-binding.json> \
  --output <new-private-review.json>
```

This example does not request or authorize new exports from a blocked source.

## Pending migration and strengthened release guard

Existing pending migration: `20261022101858_planning_and_preferences.sql`.
New CLI-generated follow-up: `20261023074854_planning_reference_ownership.sql`.
The creation CLI generated the file but did not exit normally; its own process
was terminated after confirming the generated artifact. No hosted CLI command
was executed. Local SQL content was written and tested through DevSpace.

`check_planning_schema_ready.py` now requires BOTH exact migration hashes,
validated composite foreign-key structures, selective SET NULL behavior, RLS,
authenticated reads, service-role writes and denial of all browser mutation
privileges. The release guard has been strengthened, not removed or skipped.
A missing/mismatched migration or any single-column ownership regression refuses
release. The check remains SELECT-only with a read-only connection.

## Actual verification evidence

Commands executed in this task:

```sh
python3 -m unittest discover -s scripts/tests -p 'test_*.py' -v
python3 scripts/check_planning_schema_local.py
python3 -m py_compile scripts/ledger_reconcile.py \
  scripts/check_planning_schema_ready.py scripts/check_planning_schema_local.py
bash scripts/release_public_beta.sh --check
```

- 28 offline/guard tests PASS (24 reconciliation, 4 readiness tests).
- 16 reported isolated PostgreSQL checks PASS. Network disabled, disposable
  synthetic container; cleanup confirmed.
- Negative control runs the unpatched schema and requires it to fail on a
  cross-owner preference account. Patched schema must pass the same assertions.
- Synthetic 159 → 309 fixture yields 150 append candidates; after one cloud edit
  and one deletion, those become preserve decisions, not overwrites/resurrections.
  **These are synthetic numbers, not a new inventory of the user's live data.**
- Check-only application release suite passes: 57 API tests and 34 presentation tests, plus the 28 offline/guard tests now included in the release gate (119 total). TypeScript, lint, dependency audit and build pass. Production deployment not invoked.
- Test/report logs are retained under `.qa/luna-closure-20261023/` and ignored.

## Exact remaining gates (do not paper over them)

1. The existing hosted-migration safety block must be explicitly resolved by the
   authorized host/owner workflow. Do not send the same blocked action to Luna,
   another connector, another credential, another transport or another agent.
2. Once formally cleared, the approved operator applies the two exact reviewed
   migrations in a transaction, runs the read-only guard, hosted synthetic
   persistence/isolation acceptance, then the deployment's ordinary release gate.
   This document is not that approval and does not execute those steps.
3. M4's newer source still needs an authorized fresh backup/snapshot and a trusted
   original baseline. Run the offline reconciliation, review all conflict classes,
   and only then design/approve an insert-only executor with stale-snapshot and
   transaction-lock checks. No such production executor ran in this task.
4. Real iPhone Shortcut/Wallet acceptance remains independent. Source tests or
   a successful website deployment are not proof of a physical Apple Pay tap.

This task closes reviewed code risks and makes reconciliation inspectable. It
DOES NOT close the two production-operation blockers or claim full SaaS parity.
