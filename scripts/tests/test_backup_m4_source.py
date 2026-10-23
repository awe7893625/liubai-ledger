"""Offline synthetic tests of the M4 SQLite snapshot/restore backup workflow."""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

PATH = Path(__file__).resolve().parents[1] / "backup_m4_source.py"
spec = importlib.util.spec_from_file_location("backup_m4_source", PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


def fixture(path: Path, entries: int = 2):
    with sqlite3.connect(path) as conn:
        conn.executescript("""
            create table transactions(id text primary key, amount integer not null,
              date text not null, merchant text, category_id text);
            create table categories(id text primary key, name text);
            create table funding_accounts(id text primary key, nickname text);
            insert into categories values('c', 'Food');
            insert into funding_accounts values('a', 'Wallet');
        """)
        conn.executemany(
            "insert into transactions values(?,?,?,?,?)",
            [(str(i), -(i + 1) * 100, "2026-10-23" if i % 2 else "2026-09-18",
              "Synthetic cafe " + str(i), "c") for i in range(entries)]
        )


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.source = self.base / "source.sqlite3"
        self.output = self.base / "backup"
        self.output.mkdir()
        fixture(self.source)
        self.when = dt.datetime(2026, 10, 23, 13, 9, 55, tzinfo=dt.timezone.utc)

    def test_default_no_write_has_month_totals(self):
        before = self.source.read_bytes()
        result = module.backup(self.source, self.output, write=False)
        self.assertEqual(result["status"], "INSPECTED_NO_WRITE")
        self.assertEqual(result["transaction_count"], 2)
        self.assertEqual(result["monthly_counts"], [["2026-09", 1], ["2026-10", 1]])
        self.assertEqual(list(self.output.iterdir()), [])
        self.assertEqual(before, self.source.read_bytes())

    def test_private_atomic_export_round_trips_and_does_not_mutate_source(self):
        original_sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        result = module.backup(self.source, self.output, write=True, clock=self.when)
        self.assertEqual(result["status"], "VERIFIED_PRIVATE_BACKUP")
        self.assertEqual(result["transaction_count"], 2)
        self.assertEqual(result["mode"], "0o600")
        self.assertEqual(original_sha, hashlib.sha256(self.source.read_bytes()).hexdigest())
        archive = Path(result["archive"])
        manifest = Path(result["archive"].replace(".sql.gz", ".manifest.json"))
        self.assertTrue(archive.exists())
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        self.assertEqual(manifest.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(list(self.output.iterdir())), 2)
        self.assertTrue(gzip.decompress(archive.read_bytes()).startswith(b"BEGIN TRANSACTION"))
        self.assertEqual(hashlib.sha256(archive.read_bytes()).hexdigest(), result["archive_sha256"])
        self.assertEqual(json.loads(manifest.read_text())["data_fingerprint"], result["data_fingerprint"])
        with sqlite3.connect(":memory:") as restored:
            restored.executescript(gzip.decompress(archive.read_bytes()).decode())
            self.assertEqual(restored.execute("select count(*) from transactions").fetchone()[0], 2)

    def test_backup_does_not_lose_or_duplicate_transactions_when_live_source_grows(self):
        first = module.backup(self.source, self.output, write=True, clock=self.when)
        with sqlite3.connect(self.source) as conn:
            conn.execute("insert into transactions values (?,?,?,?,?)",
                         ("new", -1000, "2026-10-23", "Later source entry", "c"))
        second = module.backup(self.source, self.output, write=True,
                               clock=self.when + dt.timedelta(seconds=1))
        self.assertEqual(first["transaction_count"], 2)
        self.assertEqual(second["transaction_count"], 3)
        self.assertNotEqual(first["data_fingerprint"], second["data_fingerprint"])
        self.assertEqual(len(list(self.output.glob("*.sql.gz"))), 2)

    def test_same_backup_timestamp_cannot_overwrite_existing_archive(self):
        first = module.backup(self.source, self.output, write=True, clock=self.when)
        before = Path(first["archive"]).read_bytes()
        with self.assertRaises(FileExistsError):
            module.backup(self.source, self.output, write=True, clock=self.when)
        self.assertEqual(before, Path(first["archive"]).read_bytes())
        self.assertEqual(len(list(self.output.iterdir())), 2)

    def test_invalid_source_is_refused_without_creating_outputs(self):
        self.source.write_bytes(b"not a sqlite database")
        with self.assertRaises((sqlite3.DatabaseError, ValueError)):
            module.backup(self.source, self.output, write=True, clock=self.when)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_empty_or_missing_source_is_refused(self):
        self.source.unlink()
        with self.assertRaises(ValueError):
            module.backup(self.source, self.output, write=True, clock=self.when)
        fixture(self.source, entries=0)
        with self.assertRaises(ValueError):
            module.backup(self.source, self.output, write=True, clock=self.when)

    def test_missing_destination_is_refused(self):
        with self.assertRaises(ValueError):
            module.backup(self.source, self.base / "not-created", write=True, clock=self.when)


if __name__ == "__main__":
    unittest.main()
