#!/usr/bin/env python3
"""Create and verify a private, consistent SQLite source backup; never touch cloud.

Default is inspection-only. --write creates a new gzip SQL-dump and private
manifest in an EXISTING backup directory. The source is opened mode=ro, snapshotted
with SQLite's online backup API into :memory:, then exported using iterdump().
Works on older macOS Python builds that lack Connection.serialize().
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
from typing import Any

MAX_SOURCE_BYTES = 100_000_000
MAX_DUMP_BYTES = 150_000_000


def fingerprint(db: sqlite3.Connection) -> str:
    """Internal audit digest; never emits transactions or raw merchant details."""
    h = hashlib.sha256()
    for table in ("transactions", "funding_accounts", "categories"):
        names = [row[1] for row in db.execute("PRAGMA table_info(" + table + ")")]
        if not names:
            raise ValueError("Missing required ledger table: " + table)
        rows = db.execute('SELECT * FROM "' + table + '" ORDER BY 1')
        h.update(table.encode("utf-8"))
        for row in rows:
            h.update(repr(tuple(row)).encode("utf-8", "surrogatepass"))
            h.update(b"\n")
    return h.hexdigest()


def metadata(db: sqlite3.Connection) -> dict[str, Any]:
    result = db.execute("PRAGMA integrity_check").fetchone()
    if not result or result[0] != "ok":
        raise ValueError("SQLite source integrity check failed")
    count = db.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    months = db.execute(
        "SELECT substr(date,1,7), COUNT(*) FROM transactions "
        "GROUP BY substr(date,1,7) ORDER BY 1"
    ).fetchall()
    if count < 1 or sum(int(x[1]) for x in months) != count:
        raise ValueError("Transaction count/month reconciliation failed")
    return {"transaction_count": count, "monthly_counts": [list(x) for x in months],
            "data_sha256": fingerprint(db)}


def backup(source: Path, destination: Path, *, write: bool, clock: dt.datetime | None = None) -> dict:
    source = source.resolve()
    if not source.is_file():
        raise ValueError("Source file not found")
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("Source exceeds bounded backup size")
    if not destination.is_dir():
        raise ValueError("Backup directory must already exist")
    if not os.access(destination, os.W_OK):
        raise ValueError("Backup destination is not writable")
    if shutil.disk_usage(destination).free < 256 * 1024 * 1024:
        raise ValueError("Insufficient backup space")
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True, timeout=20) as source_db:
        with sqlite3.connect(":memory:") as snapshot:
            source_db.backup(snapshot, pages=128, sleep=0.1)
            summary = metadata(snapshot)
            if not write:
                return {"status": "INSPECTED_NO_WRITE", "source": str(source),
                        "transaction_count": summary["transaction_count"],
                        "monthly_counts": summary["monthly_counts"]}
            dump = ("\n".join(snapshot.iterdump()) + "\n").encode("utf-8")
    if len(dump) > MAX_DUMP_BYTES:
        raise ValueError("Backup dump exceeds bounded size")
    compressed = gzip.compress(dump, compresslevel=6)
    now = clock or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        raise ValueError("A timezone-aware clock is required")
    stamp = now.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    archive = destination / ("ledger-cloud-source-" + stamp + ".sql.gz")
    temp = destination / ("." + archive.name + ".partial")
    manifest = destination / ("ledger-cloud-source-" + stamp + ".manifest.json")
    old_umask = os.umask(0o077)
    try:
        fd = os.open(str(temp), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(compressed)
                handle.flush()
                os.fsync(handle.fileno())
            if gzip.decompress(temp.read_bytes()) != dump:
                raise ValueError("Backup compression round trip failed")
            with sqlite3.connect(":memory:") as restored:
                restored.executescript(dump.decode("utf-8"))
                second = metadata(restored)
            if second != summary:
                raise ValueError("Backup restore fingerprint mismatch")
            os.link(str(temp), str(archive))  # Exclusive target creation, no overwrite.
            temp.unlink()
            result = {"status": "VERIFIED_PRIVATE_BACKUP",
                      "created_at_utc": now.astimezone(dt.timezone.utc).isoformat(),
                      "source": str(source), "archive": str(archive),
                      "archive_sha256": hashlib.sha256(compressed).hexdigest(),
                      "archive_bytes": len(compressed),
                      "transaction_count": summary["transaction_count"],
                      "monthly_counts": summary["monthly_counts"],
                      "data_fingerprint": summary["data_sha256"],
                      "mode": oct(archive.stat().st_mode & 0o777),
                      "restored_and_verified": True, "cloud_writes": 0}
            mf = os.open(str(manifest), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(mf, "w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            return result
        except Exception:
            if temp.exists():
                temp.unlink()
            raise
    finally:
        os.umask(old_umask)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--write", action="store_true", help="Create private backup; default only inspects")
    arguments = parser.parse_args()
    result = backup(arguments.source, arguments.output_dir, write=arguments.write)
    # Financial data never printed; the path stays on the owner's own computer.
    print(json.dumps({k: v for k, v in result.items() if k != "data_fingerprint"},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
