"""Pure synthetic unit tests; no credentials, network, SQL or production data."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from uuid import NAMESPACE_URL, uuid5

SCRIPT = Path(__file__).resolve().parents[1] / "ledger_reconcile.py"
spec = importlib.util.spec_from_file_location("ledger_reconcile", SCRIPT)
m = importlib.util.module_from_spec(spec); sys.modules[spec.name] = m; spec.loader.exec_module(m)
NOW = datetime(2026, 10, 23, 8, 0, tzinfo=timezone.utc)
OWNER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CATEGORY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
PROJECT = "p" * 20


def source_row(ident="old", **patch):
    return {"id": ident, "user_id": "m4-owner-fixture", "amount": -12345, "currency": "TWD", "date": "2026-10-22",
            "merchant": "PRIVATE MERCHANT " + ident, "description": None,
            "merchant_normalized": "private merchant " + ident,
            "funding_account_id": "legacy-account", "category_id": "legacy-category",
            "notes": "PRIVATE NOTE", "kind": "expense", "status": "confirmed",
            "source": "capture", "is_recurring": False, **patch}


def cloud_row(src, **patch):
    ident = src["id"]
    return {"id": str(uuid5(NAMESPACE_URL, f"liubai-ledger-m4/{OWNER}/{ident}")),
            "user_id": OWNER, "legacy_id": ident,
            "request_id": "legacy_m4_" + m.sha256(ident.encode()).hexdigest()[:32],
            "amount_minor": src["amount"], "currency": src["currency"],
            "occurred_at": src["date"] + "T04:00:00+00:00", "merchant": src["merchant"],
            "merchant_normalized": src["merchant_normalized"], "card_label": "Original Card",
            "status": src["status"], "account_id": ACCOUNT, "category_id": CATEGORY,
            "note": src["notes"], "legacy_date": src["date"], "legacy_kind": src["kind"],
            "legacy_description": src["description"], "legacy_is_recurring": False,
            "source": src["source"], **patch}


def fixture():
    old = source_row(); row = cloud_row(old)
    source = {"schema": m.SCHEMA, "source_instance_id": "m4-primary", "captured_at": NOW.isoformat(),
              "transactions": [old, source_row("new", amount=-32100)],
              "funding_accounts": [{"id": "legacy-account", "user_id": "m4-owner-fixture", "nickname": "Original Card", "currency": "TWD"}],
              "categories": [{"id": "legacy-category", "user_id": "m4-owner-fixture", "name": "Original Food"}]}
    cloud = {"schema": m.SCHEMA, "target_user_id": OWNER, "target_project_ref": PROJECT,
             "captured_at": NOW.isoformat(), "transactions": [row],
             "accounts": [{"id": ACCOUNT, "user_id": OWNER, "name": "User Renamed Card", "currency": "TWD"}],
             "categories": [{"id": CATEGORY, "user_id": OWNER, "name": "User Renamed Food"}]}
    baseline = {"schema": m.SCHEMA, "source_instance_id": "m4-primary", "target_user_id": OWNER,
                "target_project_ref": PROJECT, "created_at": (NOW-timedelta(days=1)).isoformat(),
                "entries": [{"legacy_id": "old", "source_at_import": copy.deepcopy(old), "cloud_at_import": copy.deepcopy(row)}]}
    binding = {"schema": m.SCHEMA, "source_instance_id": "m4-primary", "target_user_id": OWNER,
               "target_project_ref": PROJECT, "account_map": {"legacy-account": ACCOUNT},
               "category_map": {"legacy-category": CATEGORY}, "baseline_sha256": m.digest(baseline)}
    return source, cloud, baseline, binding


def plan(items):
    return m.build_plan(*items, now=NOW)


def classify(result, ident):
    return next(row["classification"] for row in result["decisions"] if row["source_key_sha256"] == m.digest(ident))


class ReconciliationTests(unittest.TestCase):
    def test_append_is_only_a_candidate_and_never_authorizes_a_write(self):
        result = plan(fixture())
        self.assertEqual(result["counts"], {"already_present": 1, "append_candidate": 1})
        self.assertFalse(result["apply_authorized"])
        self.assertEqual(result["write_operations"], [])
        self.assertEqual(result["delete_operations"], [])
        self.assertTrue(result["requires_new_read_and_host_authorization"])

    def test_existing_cloud_edits_are_preserved_and_reported(self):
        values = fixture(); values[1]["transactions"][0]["amount_minor"] = -999
        values[1]["transactions"][0]["merchant"] = "Edited on phone"
        result = plan(values)
        self.assertEqual(classify(result, "old"), "cloud_edited_preserve")
        fields = next(r["changed_fields"] for r in result["decisions"] if r["source_key_sha256"] == m.digest("old"))
        self.assertEqual(fields, ["cloud.amount_minor", "cloud.merchant"])
        self.assertEqual(classify(result, "new"), "append_candidate")

    def test_same_id_source_edit_is_not_hidden_by_do_nothing(self):
        values = fixture(); values[0]["transactions"][0]["notes"] = "Source changed"
        self.assertEqual(classify(plan(values), "old"), "source_changed_review")
        values[1]["transactions"][0]["note"] = "Cloud also changed"
        self.assertEqual(classify(plan(values), "old"), "both_changed_review")

    def test_deleted_cloud_rows_are_not_resurrected_even_when_all_rows_deleted(self):
        values = fixture(); values[1]["transactions"] = []
        self.assertEqual(classify(plan(values), "old"), "cloud_deleted_preserve")

    def test_cloud_only_and_source_deleted_rows_are_preserved(self):
        values = fixture(); values[0]["transactions"].pop(0)
        native = cloud_row(source_row("native"), legacy_id=None, request_id="web-native")
        values[1]["transactions"].append(native)
        result = plan(values)
        self.assertEqual(classify(result, "old"), "source_missing_preserve")
        self.assertEqual(result["cloud_native_rows_preserved"], 1)
        self.assertEqual(result["delete_operations"], [])

    def test_unlinked_duplicate_blocks_append_even_with_different_account(self):
        values = fixture(); new = values[0]["transactions"][1]
        values[1]["transactions"].append(cloud_row(new, id=str(uuid5(NAMESPACE_URL, "native")), legacy_id=None,
                                                  request_id="web-new", account_id=None))
        self.assertEqual(classify(plan(values), "new"), "unlinked_near_duplicate_review")

    def test_duplicate_source_events_are_reviewed_not_auto_deduped(self):
        values = fixture(); twin = copy.deepcopy(values[0]["transactions"][1]); twin["id"] = "twin"
        values[0]["transactions"].append(twin)
        result = plan(values)
        self.assertEqual(classify(result, "new"), "source_near_duplicate_review")
        self.assertEqual(classify(result, "twin"), "source_near_duplicate_review")

    def test_duplicate_ids_reject_entire_snapshot(self):
        for position, collection in [(0, "transactions"), (1, "transactions"), (1, "accounts"), (1, "categories")]:
            values = fixture(); values[position][collection].append(copy.deepcopy(values[position][collection][0]))
            with self.subTest(position=position, collection=collection), self.assertRaises(m.InvalidSnapshot):
                plan(values)

    def test_foreign_tenant_rows_are_never_planned(self):
        for collection in ("transactions", "accounts", "categories"):
            values = fixture(); values[1][collection][0]["user_id"] = OTHER
            with self.subTest(collection=collection), self.assertRaises(m.InvalidSnapshot): plan(values)

    def test_identity_lineage_and_baseline_hash_are_mandatory(self):
        for position, field, wrong in [(0, "source_instance_id", "older-export-host"),
                                        (1, "target_user_id", OTHER), (1, "target_project_ref", "x"*20),
                                        (2, "source_instance_id", "other-source"),
                                        (3, "baseline_sha256", "0"*64)]:
            values = fixture(); values[position][field] = wrong
            with self.subTest(field=field), self.assertRaises(m.InvalidSnapshot): plan(values)

    def test_baseline_tamper_and_missing_baseline_are_rejected(self):
        values = fixture(); values[2]["entries"] = []
        with self.assertRaises(m.InvalidSnapshot): plan(values)
        values = fixture(); values[2].pop("entries"); values[3]["baseline_sha256"] = m.digest(values[2])
        with self.assertRaises(m.InvalidSnapshot): plan(values)

    def test_duplicate_account_names_do_not_drive_mapping(self):
        values = fixture(); values[0]["funding_accounts"][0]["nickname"] = "Other same-named card"
        self.assertEqual(classify(plan(values), "new"), "append_candidate")
        values[0]["funding_accounts"].append({"id": "second", "user_id": "m4-owner-fixture", "nickname": "Other same-named card", "currency": "TWD"})
        values[3]["account_map"]["second"] = ACCOUNT
        with self.assertRaises(m.InvalidSnapshot): plan(values)

    def test_unknown_reference_and_currency_require_review(self):
        values = fixture(); values[0]["transactions"][1]["funding_account_id"] = "not-mapped"
        self.assertEqual(classify(plan(values), "new"), "unmapped_reference_review")
        values = fixture(); values[1]["accounts"][0]["currency"] = "USD"
        self.assertEqual(classify(plan(values), "new"), "currency_conflict")

    def test_pending_record_is_not_treated_as_confirmed(self):
        values = fixture(); values[0]["transactions"][1]["status"] = "pending"
        self.assertEqual(classify(plan(values), "new"), "incomplete_source_review")

    def test_unsafe_amounts_invalid_dates_and_sign_mismatch_stop_plan(self):
        for field, bad in [("amount", True), ("amount", -1.23), ("amount", -(10**18)),
                           ("amount", 100), ("date", "2026-02-30"), ("currency", "twd")]:
            values = fixture(); values[0]["transactions"][1][field] = bad
            with self.subTest(field=field, bad=bad), self.assertRaises(m.InvalidSnapshot): plan(values)

    def test_stale_future_and_naive_snapshots_are_rejected(self):
        for bad in [(NOW-timedelta(hours=1)).isoformat(), (NOW+timedelta(hours=1)).isoformat(), "2026-10-23T08:00:00"]:
            for i in (0,1):
                values = fixture(); values[i]["captured_at"] = bad
                with self.subTest(bad=bad, index=i), self.assertRaises(m.InvalidSnapshot): plan(values)

    def test_request_collision_requires_review(self):
        values = fixture(); new = values[0]["transactions"][1]
        collided = cloud_row(source_row("different"), request_id="legacy_m4_" + m.sha256(new["id"].encode()).hexdigest()[:32])
        values[1]["transactions"].append(collided)
        self.assertEqual(classify(plan(values), "new"), "identity_conflict")

    def test_unmanaged_legacy_is_not_assumed_unchanged(self):
        values = fixture(); values[1]["transactions"].append(cloud_row(values[0]["transactions"][1]))
        self.assertEqual(classify(plan(values), "new"), "unmanaged_existing_review")

    def test_acknowledged_second_run_has_no_append(self):
        values = fixture(); src = values[0]["transactions"][1]; dst = cloud_row(src)
        values[1]["transactions"].append(dst)
        values[2]["entries"].append({"legacy_id":src["id"], "source_at_import":copy.deepcopy(src), "cloud_at_import":copy.deepcopy(dst)})
        values[3]["baseline_sha256"] = m.digest(values[2])
        self.assertEqual(plan(values)["counts"], {"already_present":2})

    def test_inconsistent_cloud_dates_never_create_a_false_append_candidate(self):
        values = fixture(); src = values[0]['transactions'][1]
        values[1]['transactions'].append(cloud_row(src, id=str(uuid5(NAMESPACE_URL,'ambiguous-date')), legacy_id=None, request_id='web-date', legacy_date='2026-10-21'))
        self.assertEqual(classify(plan(values),'new'), 'ambiguous_cloud_date_review')
        values[1]['transactions'][-1]['occurred_at'] = 'not-a-date'
        with self.assertRaises(m.InvalidSnapshot): plan(values)

    def test_tombstone_survives_when_source_and_cloud_both_deleted(self):
        values = fixture(); values[0]['transactions'].pop(0); values[1]['transactions'] = []
        self.assertEqual(classify(plan(values),'old'), 'both_absent_tombstone_preserve')
        values[0]['transactions'].append(source_row())
        self.assertEqual(classify(plan(values),'old'), 'cloud_deleted_preserve')

    def test_synthetic_159_to_309_inventory_is_partitioned_not_overwritten(self):
        values = fixture(); rows = [source_row('synthetic-'+str(i), amount=-(i+1)*100) for i in range(309)]
        values[0]['transactions'] = copy.deepcopy(rows)
        values[1]['transactions'] = [cloud_row(r) for r in rows[:159]]
        values[2]['entries'] = [{'legacy_id':r['id'], 'source_at_import':copy.deepcopy(r), 'cloud_at_import':cloud_row(r)} for r in rows[:159]]
        values[3]['baseline_sha256'] = m.digest(values[2])
        result = plan(values)
        self.assertEqual(result['counts'], {'already_present':159, 'append_candidate':150})
        values[1]['transactions'].pop(0)
        values[1]['transactions'][0]['note'] = 'Phone edit'
        result = plan(values)
        self.assertEqual(result['counts'], {'already_present':157, 'append_candidate':150, 'cloud_deleted_preserve':1, 'cloud_edited_preserve':1})
        self.assertEqual(result['write_operations'], [])

    def test_non_superset_inventory_preserves_missing_rows_and_reviews_collisions(self):
        # Synthetic regression: net count growth is NOT an insertion count.
        values = fixture()
        baseline_rows = [source_row('baseline-'+str(i), amount=-(i+1)*100) for i in range(159)]
        fresh_rows = [source_row('fresh-'+str(i), amount=-(i+1001)*100) for i in range(159)]
        # Two legitimate-looking same-day records must remain a human review pair.
        fresh_rows[-1] = copy.deepcopy(fresh_rows[-2]); fresh_rows[-1]['id'] = 'fresh-158'
        values[0]['transactions'] = copy.deepcopy(baseline_rows[:154]) + fresh_rows
        values[1]['transactions'] = [cloud_row(row) for row in baseline_rows]
        values[2]['entries'] = [{'legacy_id':row['id'], 'source_at_import':copy.deepcopy(row), 'cloud_at_import':cloud_row(row)} for row in baseline_rows]
        values[3]['baseline_sha256'] = m.digest(values[2])
        # Same ID/amount/date does not imply unchanged semantics or categorization.
        values[0]['transactions'][0].update(description='Source correction', notes='Updated note', merchant_normalized='corrected merchant')
        result = plan(values)
        self.assertEqual(result['source_count'],313)
        self.assertEqual(result['cloud_count'],159)
        self.assertEqual(result['counts'], {'already_present':153, 'source_changed_review':1,
            'append_candidate':157, 'source_near_duplicate_review':2, 'source_missing_preserve':5})
        self.assertEqual(len(result['decisions']),318)
        self.assertNotEqual(result['counts']['append_candidate'],result['source_count']-result['cloud_count'])
        self.assertEqual(result['write_operations'],[])
        self.assertEqual(result['delete_operations'],[])
        # A simultaneous cloud edit is a conflict, not permission for source-wins.
        values[1]['transactions'][0]['note'] = 'Phone correction'
        self.assertEqual(classify(plan(values),'baseline-0'),'both_changed_review')

    def test_rekeyed_email_receipts_are_not_new_spending_in_314_row_topology(self):
        # Purely synthetic mirror of the observed membership pattern:
        # cloud 159 / source 314 / same IDs 154 / disappeared IDs 5 /
        # new IDs 160, of which five represent old purchases and two
        # form an independent same-day near-duplicate pair.
        values = fixture()
        baseline = [source_row('old-'+str(i), amount=-(i+1)*100,
                               merchant='Synthetic shop '+str(i),
                               source='email' if i >= 154 else 'capture')
                    for i in range(159)]
        rekeyed = [dict(row, id='replacement-'+str(i), source='capture')
                   for i, row in enumerate(baseline[154:])]
        novel = [source_row('novel-'+str(i), amount=-(i+1001)*100,
                            merchant='New synthetic shop '+str(i))
                 for i in range(155)]
        novel[-1] = dict(novel[-2], id='novel-154')
        values[0]['transactions'] = copy.deepcopy(baseline[:154] + rekeyed + novel)
        values[1]['transactions'] = [cloud_row(row) for row in baseline]
        values[2]['entries'] = [
            {'legacy_id': row['id'], 'source_at_import': copy.deepcopy(row),
             'cloud_at_import': cloud_row(row)}
            for row in baseline
        ]
        values[3]['baseline_sha256'] = m.digest(values[2])
        result = plan(values)
        self.assertEqual((result['source_count'], result['cloud_count'],
                          result['baseline_count']), (314, 159, 159))
        self.assertEqual(result['counts'], {
            'already_present': 154,
            'source_missing_preserve': 5,
            'unlinked_near_duplicate_review': 5,
            'source_near_duplicate_review': 2,
            'append_candidate': 153,
        })
        self.assertEqual(len(result['decisions']), 319)
        self.assertFalse(result['apply_authorized'])
        self.assertEqual(result['write_operations'], [])
        self.assertEqual(result['delete_operations'], [])
        # A replacement remains a review even if the original cloud row
        # was edited after import. Neither direction wins automatically.
        values[1]['transactions'][154]['merchant'] = 'Cloud user changed shop'
        self.assertEqual(classify(plan(values), 'replacement-0'),
                         'historical_baseline_signature_review')
        self.assertEqual(classify(plan(values), 'old-154'), 'source_missing_preserve')
        # Deleting the old cloud row is not permission to recreate the same
        # purchase using its replacement M4 source ID.
        values[1]['transactions'].pop(154)
        self.assertEqual(classify(plan(values), 'replacement-0'),
                         'historical_baseline_signature_review')

    def test_zero_amount_is_not_an_append_candidate(self):
        values = fixture(); values[0]['transactions'][1].update(amount=0, kind='unknown')
        self.assertEqual(classify(plan(values),'new'), 'incomplete_source_review')

    def test_rekeyed_purchase_with_one_corrected_field_stays_review_only(self):
        for field, corrected in (("merchant", "Revised merchant"),
                                 ("amount", -12000),
                                 ("date", "2026-10-23")):
            values = fixture()
            old = copy.deepcopy(values[0]["transactions"][0])
            replacement = dict(old, id="new-source-id")
            replacement[field] = corrected
            values[0]["transactions"] = [replacement]
            # User may have renamed or deleted the original cloud row.
            values[1]["transactions"] = []
            with self.subTest(changed_field=field):
                result = plan(values)
                self.assertEqual(classify(result, "new-source-id"),
                                 "historical_weak_match_review")
                self.assertEqual(classify(result, "old"),
                                 "both_absent_tombstone_preserve")
                self.assertEqual(result["write_operations"], [])

    def test_multiple_corrected_signature_fields_cannot_be_auto_authorized(self):
        values = fixture()
        old = copy.deepcopy(values[0]["transactions"][0])
        replacement = dict(old, id="new-id", amount=-9999,
                           merchant="Changed name", merchant_normalized="changed name")
        values[0]["transactions"] = [replacement]
        values[1]["transactions"] = []
        result = plan(values)
        # Without an immutable issuer reference this case is fundamentally
        # ambiguous. An append candidate is not an execution instruction.
        self.assertEqual(classify(result, "new-id"), "append_candidate")
        self.assertFalse(result["apply_authorized"])
        self.assertTrue(result["requires_new_read_and_host_authorization"])
        self.assertEqual(result["write_operations"], [])
        self.assertEqual(result["delete_operations"], [])

    def test_confirmed_unknown_and_unpaired_transfer_never_auto_append(self):
        for kind in ("unknown", "transfer"):
            values = fixture()
            values[0]["transactions"][1]["kind"] = kind
            with self.subTest(kind=kind):
                self.assertEqual(classify(plan(values), "new"),
                                 "nonstandard_kind_review")
        values = fixture()
        values[0]["transactions"][1].update(amount=5000, kind="refund")
        self.assertEqual(classify(plan(values), "new"), "append_candidate")

    def test_malformed_cloud_matching_fields_fail_closed(self):
        for field, malformed in (("currency", None), ("currency", "NTDollars"),
                                 ("merchant", 123), ("merchant_normalized", {})):
            values = fixture()
            values[1]["transactions"][0][field] = malformed
            with self.subTest(field=field, bad=malformed), self.assertRaises(m.InvalidSnapshot):
                plan(values)

    def test_mixed_local_owner_records_fail_closed(self):
        for table in ("transactions", "funding_accounts", "categories"):
            values = fixture()
            values[0][table][0]["user_id"] = "other-m4-ledger-owner"
            with self.subTest(table=table), self.assertRaisesRegex(m.InvalidSnapshot, "owner"):
                plan(values)

    def test_owner_missing_in_one_source_reference_fails_closed(self):
        for table in ("transactions", "funding_accounts", "categories"):
            values = fixture()
            values[0][table][0].pop("user_id")
            with self.subTest(table=table), self.assertRaisesRegex(m.InvalidSnapshot, "owner"):
                plan(values)

    def test_empty_acknowledged_baseline_rejected_even_with_matching_digest(self):
        values = fixture()
        values[2]["entries"] = []
        values[3]["baseline_sha256"] = m.digest(values[2])
        with self.assertRaisesRegex(m.InvalidSnapshot, "acknowledged import"):
            plan(values)

    def test_source_owner_rekey_does_not_switch_import_target(self):
        values = fixture()
        for table in ("transactions", "funding_accounts", "categories"):
            for row in values[0][table]:
                row["user_id"] = "reassigned-ledger-owner"
        with self.assertRaisesRegex(m.InvalidSnapshot, "acknowledged import"):
            plan(values)

    def test_report_does_not_leak_raw_financial_values_or_mutate_inputs(self):
        values = fixture(); original = copy.deepcopy(values); report = plan(values)
        text = json.dumps(report)
        for private in ("PRIVATE MERCHANT", "PRIVATE NOTE", OWNER, ACCOUNT, CATEGORY, "Original Card", "12345", "32100"):
            self.assertNotIn(private, text)
        self.assertEqual(values, original)


if __name__ == "__main__": unittest.main()
