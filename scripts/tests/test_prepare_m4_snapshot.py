"""Synthetic-only tests of converting a verified local backup to an offline snapshot."""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import backup_m4_source as backup
import prepare_m4_snapshot as adapter


def fixture(path: Path):
    with sqlite3.connect(path) as db:
        db.executescript("""
            create table transactions(id text primary key, amount integer, currency text,
              date text, merchant text, description text, merchant_normalized text,
              funding_account_id text, category_id text, notes text, kind text,
              status text, source text, is_recurring integer, user_id text);
            create table funding_accounts(id text primary key, nickname text, currency text);
            create table categories(id text primary key, slug text, name text);
            insert into funding_accounts values('a', 'Private Visa', 'TWD');
            insert into categories values('c', 'food', 'Food');
            insert into transactions values
              ('t1', -12345, 'TWD', '2026-10-22', 'Cafe', null, 'cafe',
                'a', 'c', 'Private note', 'expense', 'confirmed', 'capture', 0, 'local-owner');
            insert into transactions values
              ('t2', 50000, 'TWD', '2026-10-23', 'Salary', null, 'salary',
                'a', null, null, 'income', 'confirmed', 'manual', 0, 'local-owner');
        """)


class SourceAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.source = root / "source.db"
        self.backups = root / "backups"
        self.output = root / "out"
        self.backups.mkdir()
        self.output.mkdir()
        fixture(self.source)
        self.clock = dt.datetime(2026, 10, 23, 13, 9, tzinfo=dt.timezone.utc)
        self.record = backup.backup(self.source, self.backups, write=True, clock=self.clock)
        self.archive = Path(self.record["archive"])
        self.manifest = Path(str(self.archive).replace(".sql.gz", ".manifest.json"))

    def test_verified_backup_becomes_correct_source_snapshot_without_upload(self):
        result = adapter.prepare(self.archive, self.manifest, "m4-primary")
        self.assertEqual(result["schema"], "ledger-offline-reconciliation-v1")
        self.assertEqual(result["source_instance_id"], "m4-primary")
        self.assertEqual(result["captured_at"], "2026-10-23T13:09:00+00:00")
        self.assertEqual(len(result["transactions"]), 2)
        self.assertFalse(result["transactions"][0]["is_recurring"])
        self.assertEqual(result["transactions"][0]["amount"], -12345)
        self.assertEqual(len(result["funding_accounts"]), 1)
        self.assertEqual(len(result["categories"]), 1)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_explicit_export_is_private_and_exclusive(self):
        snapshot = adapter.prepare(self.archive, self.manifest, "m4-primary")
        result = adapter.export_snapshot(snapshot, self.output / "snapshot.json")
        exported = Path(result["source_snapshot"])
        self.assertEqual(exported.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(exported.read_text()), snapshot)
        self.assertFalse(result["cloud_write"])
        self.assertFalse(result["cloud_read"])
        with self.assertRaises(FileExistsError):
            adapter.export_snapshot(snapshot, exported)

    def test_changed_manifest_hash_is_rejected(self):
        bad = json.loads(self.manifest.read_text())
        bad["archive_sha256"] = "0" * 64
        self.manifest.write_text(json.dumps(bad))
        with self.assertRaises(ValueError):
            adapter.prepare(self.archive, self.manifest, "m4-primary")

    def test_changed_manifest_row_count_is_rejected(self):
        bad = json.loads(self.manifest.read_text())
        bad["transaction_count"] = 1000
        self.manifest.write_text(json.dumps(bad))
        with self.assertRaises(ValueError):
            adapter.prepare(self.archive, self.manifest, "m4-primary")

    def test_changed_manifest_month_counts_are_rejected(self):
        bad = json.loads(self.manifest.read_text())
        bad["monthly_counts"] = [["2026-10", 1]]
        self.manifest.write_text(json.dumps(bad))
        with self.assertRaises(ValueError):
            adapter.prepare(self.archive, self.manifest, "m4-primary")

    def test_unverified_or_insecure_backup_is_refused(self):
        self.archive.chmod(0o644)
        with self.assertRaises(ValueError):
            adapter.prepare(self.archive, self.manifest, "m4-primary")

    def test_invalid_instance_and_missing_output_parent_are_rejected(self):
        with self.assertRaises(ValueError):
            adapter.prepare(self.archive, self.manifest, "bad/instance")
        snapshot = adapter.prepare(self.archive, self.manifest, "m4-primary")
        with self.assertRaises(ValueError):
            adapter.export_snapshot(snapshot, self.output / "nonexistent" / "snapshot.json")

    def test_tracked_checkout_output_is_rejected_before_any_financial_write(self):
        snapshot = adapter.prepare(self.archive, self.manifest, "m4-primary")
        forbidden = ROOT / "frontend" / "public" / "private-transactions.json"
        with self.assertRaises(ValueError):
            adapter.export_snapshot(snapshot, forbidden)
        self.assertFalse(forbidden.exists())

    def test_multiple_local_owners_are_rejected(self):
        with sqlite3.connect(self.source) as db:
            db.execute("update transactions set user_id='other-user' where id='t2'")
        new = backup.backup(self.source, self.backups, write=True,
                            clock=self.clock + dt.timedelta(seconds=1))
        new_archive = Path(new["archive"])
        new_manifest = Path(str(new_archive).replace(".sql.gz", ".manifest.json"))
        with self.assertRaises(ValueError):
            adapter.prepare(new_archive, new_manifest, "m4-primary")


if __name__ == "__main__":
    unittest.main()
