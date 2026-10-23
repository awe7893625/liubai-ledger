#!/usr/bin/env python3
"""Offline-only, non-mutating legacy Ledger reconciliation.

Consumes authorized snapshots, never reads .env, connects to a DB or contacts M4.
The result is a redacted review manifest, NOT SQL and NOT permission to import.
An immutable acknowledged-import baseline is required to retain deletion history.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
from typing import Any
import unicodedata
from uuid import NAMESPACE_URL, UUID, uuid5

SCHEMA = "ledger-offline-reconciliation-v1"
MAX_MINOR = 9_000_000_000_000
SOURCE_FIELDS = ("id", "amount", "currency", "date", "merchant", "description",
                 "merchant_normalized", "funding_account_id", "category_id", "notes",
                 "kind", "status", "source", "is_recurring")
CLOUD_FIELDS = ("id", "user_id", "legacy_id", "request_id", "amount_minor", "currency",
                "occurred_at", "merchant", "merchant_normalized", "card_label", "status",
                "account_id", "category_id", "note", "legacy_date", "legacy_kind",
                "legacy_description", "legacy_is_recurring", "source")
ALLOWED_SOURCES = {"capture", "email", "statement", "manual", "apple_pay", "notification"}


class InvalidSnapshot(ValueError):
    """Fail-closed error; deliberately does not include financial field values."""


def digest(value: Any) -> str:
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                             separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def timestamp(value: Any) -> datetime:
    if not isinstance(value, str):
        raise InvalidSnapshot("Missing timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise InvalidSnapshot("Invalid timestamp") from error
    if parsed.tzinfo is None:
        raise InvalidSnapshot("Timestamp must include an explicit timezone")
    return parsed.astimezone(timezone.utc)


def key(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 160:
        raise InvalidSnapshot("Invalid record identifier")
    return value


def uuid(value: Any) -> str:
    try:
        return str(UUID(value))
    except (ValueError, AttributeError, TypeError) as error:
        raise InvalidSnapshot("Invalid immutable user/reference ID") from error


def index(rows: Any, field: str = "id") -> dict[str, dict]:
    if not isinstance(rows, list) or len(rows) > 100_000:
        raise InvalidSnapshot("Invalid snapshot collection")
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise InvalidSnapshot("Invalid snapshot record")
        ident = key(row.get(field))
        if ident in result:
            raise InvalidSnapshot("Duplicate identifier; snapshot rejected")
        result[ident] = row
    return result


def projection(row: dict, fields: tuple[str, ...]) -> dict:
    return {field: row.get(field) for field in fields}


def changes(left: dict, right: dict, fields: tuple[str, ...]) -> list[str]:
    return [field for field in fields if left.get(field) != right.get(field)]


def assert_minor(value: Any, *, nullable: bool = False) -> None:
    if nullable and value is None:
        return
    if type(value) is not int or abs(value) > MAX_MINOR:
        raise InvalidSnapshot("Amounts must be bounded integer minor units")


def assert_day(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", value):
        raise InvalidSnapshot("Invalid calendar date")
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except ValueError as error:
        raise InvalidSnapshot("Invalid calendar date") from error
    return value


def normalize_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def validate_source(row: dict) -> None:
    key(row.get("id")); assert_minor(row.get("amount")); assert_day(row.get("date"))
    if not isinstance(row.get("currency"), str) or not re.fullmatch(r"[A-Z]{3}", row["currency"]):
        raise InvalidSnapshot("Invalid currency")
    if row.get("source") not in ALLOWED_SOURCES:
        raise InvalidSnapshot("Unmapped source; do not guess")
    if row.get("kind") not in {"expense", "income", "refund", "transfer", "unknown"}:
        raise InvalidSnapshot("Unmapped transaction kind")
    if row.get("status") not in {"confirmed", "pending", "duplicate", "error"}:
        raise InvalidSnapshot("Unmapped source status")
    if row["kind"] == "expense" and row["amount"] >= 0:
        raise InvalidSnapshot("Expense sign disagrees with source kind")
    if row["kind"] in {"income", "refund"} and row["amount"] <= 0:
        raise InvalidSnapshot("Positive kind disagrees with source amount")


def cloud_days(row: dict) -> set[str]:
    from zoneinfo import ZoneInfo
    # Validate timestamp even when a legacy purchase day is present. Disagreement
    # is not silently resolved: both days participate in conservative matching.
    instant_day = timestamp(row["occurred_at"]).astimezone(ZoneInfo("Asia/Taipei")).date().isoformat()
    legacy_day = assert_day(row["legacy_date"]) if row.get("legacy_date") else instant_day
    return {instant_day, legacy_day}


def cloud_day(row: dict) -> str:
    days = cloud_days(row)
    return row["legacy_date"] if row.get("legacy_date") else next(iter(days))


def near_key(row: dict, source: bool, day: str | None = None) -> tuple:
    # Broad on purpose: a match prompts human review, never automatic suppression.
    return (row["currency"].strip(), row["amount"] if source else row.get("amount_minor"),
            row["date"] if source else (day or cloud_day(row)),
            normalize_name((row.get("merchant") or row.get("description")) if source else row.get("merchant")))


def build_plan(source: dict, cloud: dict, baseline: dict, binding: dict,
               *, now: datetime | None = None, max_age_seconds: int = 900) -> dict:
    """Classify append candidates and conflicts; never return update/delete actions.

    `baseline.entries` are receipts retained independently of cascading cloud
    provenance: {legacy_id, source_at_import, cloud_at_import}. Their immutable
    digest must match the separately supplied, reviewed binding. Rebuilding this
    baseline from a current edited/deleted cloud snapshot is unsafe and unsupported.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or type(max_age_seconds) is not int or max_age_seconds < 1:
        raise InvalidSnapshot("Invalid review clock/age policy")
    if binding.get("schema") != SCHEMA or any(s.get("schema") != SCHEMA for s in (source, cloud, baseline)):
        raise InvalidSnapshot("Unknown snapshot contract")
    owner = uuid(binding.get("target_user_id"))
    project = key(binding.get("target_project_ref"))
    instance = key(binding.get("source_instance_id"))
    if not re.fullmatch(r"[a-z]{20}", project):
        raise InvalidSnapshot("Unexpected project reference")
    if cloud.get("target_user_id") != owner or cloud.get("target_project_ref") != project:
        raise InvalidSnapshot("Cloud target does not match reviewed binding")
    if source.get("source_instance_id") != instance or baseline.get("source_instance_id") != instance:
        raise InvalidSnapshot("Source lineage mismatch")
    if baseline.get("target_user_id") != owner or baseline.get("target_project_ref") != project:
        raise InvalidSnapshot("Acknowledged baseline belongs to a different target")
    if digest(baseline) != binding.get("baseline_sha256"):
        raise InvalidSnapshot("Acknowledged baseline digest mismatch")
    for snapshot in (source, cloud):
        age = (now - timestamp(snapshot.get("captured_at"))).total_seconds()
        if age < -60 or age > max_age_seconds:
            raise InvalidSnapshot("Stale/future snapshot; obtain new authorized read-only snapshots")
    if timestamp(baseline.get("created_at")) > now:
        raise InvalidSnapshot("Baseline timestamp is in the future")
    src = index(source.get("transactions")); dst = index(cloud.get("transactions"))
    src_accounts = index(source.get("funding_accounts")); src_categories = index(source.get("categories"))
    dst_accounts = index(cloud.get("accounts")); dst_categories = index(cloud.get("categories"))
    prior = index(baseline.get("entries"), "legacy_id")
    for rows in (dst, dst_accounts, dst_categories):
        if any(row.get("user_id") != owner for row in rows.values()):
            raise InvalidSnapshot("Snapshot contains a foreign tenant row")
    legacy = {}; requests = {}; nearby = defaultdict(list); ambiguous_dates = set()
    for row in dst.values():
        assert_minor(row.get("amount_minor"), nullable=True)
        uuid(row["id"]); days = cloud_days(row)
        if len(days) > 1:
            ambiguous_dates.add(row["id"])
        for field, lookup in (("legacy_id", legacy), ("request_id", requests)):
            ident = row.get(field)
            if ident:
                key(ident)
                if ident in lookup:
                    raise InvalidSnapshot("Duplicate cloud legacy/request identifier")
                lookup[ident] = row
        if row.get("amount_minor") is not None:
            for day in days:
                nearby[near_key(row, False, day)].append(row)
    account_map = binding.get("account_map"); category_map = binding.get("category_map")
    if not isinstance(account_map, dict) or not isinstance(category_map, dict):
        raise InvalidSnapshot("Explicit reference maps required; names are not identities")
    for mapping, a, b in ((account_map, src_accounts, dst_accounts), (category_map, src_categories, dst_categories)):
        if len(set(mapping.values())) != len(mapping):
            raise InvalidSnapshot("Many-to-one reference map requires separate review")
        for old, new in mapping.items():
            if old not in a or new not in b:
                raise InvalidSnapshot("Reference mapping points outside its scoped snapshots")
            uuid(new)
    for old, receipt in prior.items():
        original = receipt.get("source_at_import"); saved = receipt.get("cloud_at_import")
        if not isinstance(original, dict) or not isinstance(saved, dict):
            raise InvalidSnapshot("Incomplete acknowledged import receipt")
        validate_source(original)
        if original["id"] != old or saved.get("legacy_id") != old or saved.get("user_id") != owner:
            raise InvalidSnapshot("Baseline identity mismatch")
        uuid(saved.get("id"))
    decisions = []
    new_nearby = defaultdict(list)
    for row in src.values():
        validate_source(row)
        if row["id"] not in prior and row["id"] not in legacy:
            new_nearby[near_key(row, True)].append(row["id"])

    def record(ident: str, classification: str, fields: list[str] | None = None,
               candidates: list[str] | None = None) -> None:
        decisions.append({"source_key_sha256": digest(ident), "classification": classification,
                          "changed_fields": fields or [],
                          "related_cloud_keys_sha256": sorted(digest(v) for v in (candidates or []))})

    for ident, row in src.items():
        present = legacy.get(ident); receipt = prior.get(ident)
        if receipt and not present:
            record(ident, "cloud_deleted_preserve"); continue
        if present:
            if not receipt:
                record(ident, "unmanaged_existing_review"); continue
            if present["id"] != receipt["cloud_at_import"]["id"]:
                record(ident, "identity_conflict"); continue
            source_changed = changes(receipt["source_at_import"], row, SOURCE_FIELDS)
            cloud_changed = changes(receipt["cloud_at_import"], present, CLOUD_FIELDS)
            classification = ("both_changed_review" if source_changed and cloud_changed else
                              "source_changed_review" if source_changed else
                              "cloud_edited_preserve" if cloud_changed else "already_present")
            record(ident, classification, ["source." + f for f in source_changed] + ["cloud." + f for f in cloud_changed]); continue
        if row.get("status") != "confirmed" or row["amount"] == 0 or not (row.get("merchant") or row.get("description")):
            record(ident, "incomplete_source_review"); continue
        old_account = row.get("funding_account_id"); old_category = row.get("category_id")
        if old_account not in account_map or (old_category and old_category not in category_map):
            record(ident, "unmapped_reference_review"); continue
        target_account = dst_accounts[account_map[old_account]]
        if target_account.get("currency", "").strip() != row["currency"] or src_accounts[old_account].get("currency") != row["currency"]:
            record(ident, "currency_conflict"); continue
        request_id = "legacy_m4_" + sha256(ident.encode()).hexdigest()[:32]
        cloud_id = str(uuid5(NAMESPACE_URL, f"liubai-ledger-m4/{owner}/{ident}"))
        if request_id in requests or cloud_id in dst:
            record(ident, "identity_conflict"); continue
        candidates = nearby.get(near_key(row, True), [])
        if candidates:
            classification = "ambiguous_cloud_date_review" if any(r["id"] in ambiguous_dates for r in candidates) else "unlinked_near_duplicate_review"
            record(ident, classification, candidates=[r["id"] for r in candidates]); continue
        if len(new_nearby[near_key(row, True)]) > 1:
            record(ident, "source_near_duplicate_review"); continue
        record(ident, "append_candidate")
    for ident in sorted(set(legacy) - set(src)):
        record(ident, "source_missing_preserve")
    for ident in sorted(set(prior) - set(src) - set(legacy)):
        record(ident, "both_absent_tombstone_preserve")
    counts = dict(sorted(Counter(item["classification"] for item in decisions).items()))
    return {"schema": SCHEMA, "mode": "offline_review_only", "generated_at": now.isoformat(),
            "source_snapshot_sha256": digest(source), "cloud_snapshot_sha256": digest(cloud),
            "baseline_sha256": digest(baseline), "binding_sha256": digest(binding),
            "target_user_sha256": digest(owner), "source_instance_sha256": digest(instance),
            "source_count": len(src), "cloud_count": len(dst), "baseline_count": len(prior),
            "cloud_native_rows_preserved": sum(not row.get("legacy_id") for row in dst.values()),
            "counts": counts, "decisions": sorted(decisions, key=lambda item: item["source_key_sha256"]),
            "apply_authorized": False, "write_operations": [], "delete_operations": [],
            "requires_new_read_and_host_authorization": True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "cloud", "baseline", "binding", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    snapshots = [json.loads(getattr(args, name).read_text()) for name in ("source", "cloud", "baseline", "binding")]
    report = build_plan(*snapshots)
    # Exclusive creation avoids replacing a prior receipt; file is private by default.
    fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    print(json.dumps({"mode": report["mode"], "counts": report["counts"], "apply_authorized": False}))


if __name__ == "__main__":
    main()
