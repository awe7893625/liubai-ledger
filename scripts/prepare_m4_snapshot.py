#!/usr/bin/env python3
"""Inspect or privately export an authorized M4 SQLite backup for offline review.

Default does not write anything. --write creates a 0600 source snapshot.
This is NOT a cloud importer, migration runner or sync authorization.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3

from ledger_reconcile import SCHEMA, validate_source

MAX_COMPRESSED = 100_000_000
MAX_SQL = 150_000_000


def load_verified_backup(archive: Path, manifest: Path):
    archive = archive.resolve()
    info = json.loads(manifest.read_text(encoding="utf-8"))
    if info.get("result") != "VERIFIED" and info.get("status") != "VERIFIED_PRIVATE_BACKUP":
        raise ValueError("Backup has no successful verification receipt")
    path = info.get("backup_file") or info.get("archive")
    if not isinstance(path, str) or Path(path).resolve() != archive:
        raise ValueError("Backup and verification manifest do not match")
    if not archive.is_file() or archive.stat().st_size > MAX_COMPRESSED:
        raise ValueError("Missing or excessive backup")
    if (archive.stat().st_mode & 0o077) != 0:
        raise ValueError("Backup must not be accessible to group or others")
    binary = archive.read_bytes()
    if hashlib.sha256(binary).hexdigest() != (info.get("sha256") or info.get("archive_sha256")):
        raise ValueError("Backup hash mismatch")
    with gzip.open(archive, "rb") as f:
        script = f.read(MAX_SQL + 1)
    if len(script) > MAX_SQL:
        raise ValueError("Backup decompression bound exceeded")
    timestamp = info.get("created_at_utc") or info.get("created_utc")
    if not isinstance(timestamp, str):
        raise ValueError("Backup capture time missing")
    instant = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError("Backup capture time must be timezone-aware")
    return script, info, instant.astimezone(dt.timezone.utc)


def prepare(archive: Path, manifest: Path, instance: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{3,64}", instance):
        raise ValueError("Invalid source instance ID")
    script, info, instant = load_verified_backup(archive, manifest)
    with sqlite3.connect(":memory:") as db:
        db.executescript(script.decode("utf-8"))
        db.row_factory = sqlite3.Row
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Restored database is invalid")
        tables = {
            "transactions": [dict(row) for row in db.execute("SELECT * FROM transactions ORDER BY id")],
            "funding_accounts": [dict(row) for row in db.execute("SELECT * FROM funding_accounts ORDER BY id")],
            "categories": [dict(row) for row in db.execute("SELECT * FROM categories ORDER BY id")],
        }
    for row in tables["transactions"]:
        if "is_recurring" in row and row["is_recurring"] is not None:
            if row["is_recurring"] not in (0, 1, False, True):
                raise ValueError("Unexpected recurring flag")
            row["is_recurring"] = bool(row["is_recurring"])
        validate_source(row)
    for name in ("transactions", "funding_accounts", "categories"):
        identifiers = [r["id"] for r in tables[name]]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Duplicate primary keys")
    if len(tables["transactions"]) != info.get("transaction_count"):
        raise ValueError("Backup transaction total differs from receipt")
    months = {}
    for item in tables["transactions"]:
        month = item["date"][:7]
        months[month] = months.get(month, 0) + 1
    if [[month, months[month]] for month in sorted(months)] != info.get("monthly_counts"):
        raise ValueError("Backup month totals differ from receipt")
    # Check ALL financial reference tables, not only transactions. A populated
    # second owner's account/category would otherwise be silently bundled into
    # the snapshot and potentially mapped to the cloud target.
    owners = {row.get("user_id") for table in tables.values() for row in table}
    if len(owners) != 1 or not all(isinstance(value, str) and value.strip() for value in owners):
        raise ValueError("Expected a single, consistent, nonempty local M4 owner across all tables")
    snapshot = {"schema": SCHEMA, "source_instance_id": instance,
                "captured_at": instant.isoformat(), **tables}
    return snapshot


def export_snapshot(snapshot: dict, output: Path) -> dict:
    if not output.parent.is_dir():
        raise ValueError("Output parent must already exist")
    # Never write raw account transactions into the tracked or web-published tree.
    project = Path(__file__).resolve().parents[1]
    target_parent = output.parent.resolve()
    if project == target_parent or project in target_parent.parents:
        private_root = project / ".qa"
        if private_root != target_parent and private_root not in target_parent.parents:
            raise ValueError("Private transaction exports in this project must be under ignored .qa")
    if output.suffix != ".json":
        raise ValueError("Source snapshot requires a .json extension")
    content = (json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    old_umask = os.umask(0o077)
    try:
        fd = os.open(str(output), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        if json.loads(output.read_text(encoding="utf-8")) != snapshot:
            raise ValueError("Saved source snapshot failed read-back")
    finally:
        os.umask(old_umask)
    return {"source_snapshot": str(output), "source_snapshot_sha256": hashlib.sha256(content).hexdigest(),
            "rows": len(snapshot["transactions"]), "mode": oct(output.stat().st_mode & 0o777),
            "cloud_write": False, "cloud_read": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--source-instance-id", required=True)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    snapshot = prepare(args.backup, args.manifest, args.source_instance_id)
    counts = {"status": "VERIFIED_LOCAL_SOURCE_SNAPSHOT", "source_rows": len(snapshot["transactions"]),
              "backup_captured_at": snapshot["captured_at"], "requires_fresh_cloud_read": True,
              "apply_authorized": False}
    if args.write:
        if not args.output:
            parser.error("--write requires --output")
        counts.update(export_snapshot(snapshot, args.output))
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
