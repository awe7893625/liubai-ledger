"""Canonical occurred_at storage format.

Fixed-length UTC ISO string with no microseconds, e.g. "2026-09-04T07:30:00Z".
Fixed length + UTC + zero-padded fields means plain string comparison sorts
the same as chronological order — no timezone/offset/precision drift between
write paths.
"""
from __future__ import annotations

from datetime import datetime, timezone


def to_storage(dt: datetime) -> str:
    """Normalize dt to the canonical occurred_at storage string.

    Naive datetimes are assumed to already be in local time and are
    converted to UTC via astimezone(); aware datetimes are converted as-is.
    """
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
