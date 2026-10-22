#!/usr/bin/env python3
"""Idempotent, audited M4 Ledger export -> one verified Google tenant in Ledger Cloud.

No browser/service token use. Requires a locally backed-up M4 export and a
TLS-verified server-side Postgres connection. Defaults to read-only dry-run.
NEVER writes to the M4 API. Stores full source rows in a private audit schema.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime, time, timezone
from hashlib import sha256
import json
from pathlib import Path
import os
from urllib.parse import urlparse
from uuid import NAMESPACE_URL, UUID, uuid5
from zoneinfo import ZoneInfo

import psycopg2
from dotenv import dotenv_values

MIGRATION = "20261022021424_import_legacy_ledger_transactions.sql"
SOURCES = {"capture", "email", "statement"}
KINDS = {"expense", "income", "refund", "transfer", "unknown"}
ACCOUNT_TYPES = {"credit_card": "card", "cash": "cash", "bank_account": "bank", "other": "other"}


def dump_private(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        os.fchmod(f.fileno(), 0o600)
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)


def source_checks(source: dict) -> None:
    txs = source.get("transactions")
    accounts = source.get("funding_accounts")
    categories = source.get("categories")
    if not all(isinstance(v, list) for v in (txs, accounts, categories)):
        raise ValueError("Malformed M4 export")
    if not txs or not accounts or not categories:
        raise ValueError("Refusing to import an empty source")
    if len({r["id"] for r in txs}) != len(txs):
        raise ValueError("Duplicate transaction IDs")
    account_ids = {r["id"] for r in accounts}
    category_ids = {r["id"] for r in categories}
    if len(account_ids) != len(accounts) or len(category_ids) != len(categories):
        raise ValueError("Duplicate account/category IDs")
    if len({r["slug"] for r in categories}) != len(categories):
        raise ValueError("Category slug collision")
    for r in txs:
        if r["funding_account_id"] not in account_ids:
            raise ValueError("Unknown source account")
        if r.get("category_id") and r["category_id"] not in category_ids:
            raise ValueError("Unknown source category")
        if type(r["amount"]) is not int:
            raise ValueError("Expected exact integer minor-unit amount")
        if r["currency"] != "TWD" or r["source"] not in SOURCES:
            raise ValueError("Unexpected currency/source: requires new mapping")
        if r.get("kind") not in KINDS:
            raise ValueError("Unexpected transaction kind")
        if r["status"] != "confirmed":
            raise ValueError("Unexpected status: would require review")
        date.fromisoformat(r["date"])
        if not (r.get("merchant") or r.get("description")):
            raise ValueError("Empty transaction merchant and description")


def owner(cur, expected_display: str, expected_user_id: str, expected_username: str):
    # Authorize the explicit owner-approved immutable ID and server-controlled
    # identity mapping. User-editable auth metadata is never an ownership proof.
    UUID(expected_user_id)
    cur.execute("""
      select p.user_id from public.ledger_profiles p
      join public.ledger_google_identities g on g.user_id=p.user_id
      where p.user_id=%s and p.username_norm=%s and p.username_display=%s
        and p.username_norm='g-' || left(g.subject_hash,20)
    """, (expected_user_id, expected_username, expected_display))
    matches = cur.fetchall()
    if len(matches) != 1:
        raise ValueError("Ambiguous or missing Google target account; refusing write")
    return matches[0][0]


def inspect(cur, user_id):
    snapshot = {}
    for table in ("ledger_profiles", "ledger_accounts", "ledger_categories", "ledger_transactions"):
        cur.execute(f"select to_jsonb(x) from public.{table} x where user_id=%s", (str(user_id),))
        snapshot[table] = [r[0] for r in cur.fetchall()]
    return snapshot


def metrics(cur, user_id):
    cur.execute("""
      select count(*)::int, coalesce(sum(amount_minor),0)::bigint,
             count(distinct legacy_id)::int
      from public.ledger_transactions
      where user_id=%s and legacy_id is not null
    """, (str(user_id),))
    count, minor, unique = cur.fetchone()
    cur.execute("""
      select legacy_date::text, count(*)::int, sum(amount_minor)::bigint
      from public.ledger_transactions
      where user_id=%s and legacy_id is not null
      group by legacy_date order by legacy_date
    """, (str(user_id),))
    daily = [tuple(r) for r in cur.fetchall()]
    cur.execute("""
      select count(*)::int from ledger_ops.legacy_tx_provenance where user_id=%s
    """, (str(user_id),))
    provenance_count = cur.fetchone()[0]
    return {"count": count, "sum_minor": minor,
            "unique_legacy_ids": unique, "provenance_count": provenance_count,
            "daily": daily}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--env-file", type=Path, required=True)
    ap.add_argument("--ca-file", type=Path, required=True)
    ap.add_argument("--migration-file", type=Path, required=True)
    ap.add_argument("--expected-project-ref", required=True)
    ap.add_argument("--expected-display-name", required=True)
    ap.add_argument("--expected-user-id", required=True)
    ap.add_argument("--expected-username", required=True)
    ap.add_argument("--output-dir", type=Path, required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    source_bytes = args.source.read_bytes()
    source = json.loads(source_bytes)
    source_checks(source)
    src_txs = source["transactions"]
    expected_total = sum(r["amount"] for r in src_txs)
    source_by_day = Counter()
    for row in src_txs:
        source_by_day[row["date"]] += row["amount"]

    env = dotenv_values(args.env_file)
    project = args.expected_project_ref
    if urlparse(env["SUPABASE_URL"]).hostname != f"{project}.supabase.co":
        raise ValueError("Unexpected target Supabase URL")
    if project not in (urlparse(env["POSTGRES_URL_NON_POOLING"]).username or ""):
        raise ValueError("Unexpected target Postgres connection")
    if not args.ca_file.is_file():
        raise ValueError("Missing Postgres TLS root CA")
    conn = psycopg2.connect(env["POSTGRES_URL_NON_POOLING"],
        sslmode="verify-full", sslrootcert=str(args.ca_file.resolve()),
        connect_timeout=20)
    try:
        with conn.cursor() as cur:
            cur.execute("set transaction read only")
            target = owner(cur, args.expected_display_name, args.expected_user_id, args.expected_username)
            before = inspect(cur, target)
            cur.execute("select count(*) from public.ledger_transactions where user_id<>%s", (str(target),))
            others_before = cur.fetchone()[0]
            conn.rollback()

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        snapshot_file = args.output_dir / f"cloud-before-{stamp}.json"
        dump_private(snapshot_file, {
            "project_ref":project, "target_display":args.expected_display_name,
            "snapshot":before, "created_utc":datetime.now(timezone.utc).isoformat()
        })
        print("PREFLIGHT", json.dumps({
            "mode":"APPLY" if args.apply else "DRY_RUN",
            "source_count":len(src_txs), "source_accounts":len(source["funding_accounts"]),
            "source_categories":len(source["categories"]),
            "sum_minor":expected_total, "source_sha256":sha256(source_bytes).hexdigest()[:12],
            "target_existing_transactions":len(before["ledger_transactions"]),
            "other_users_existing_transactions":others_before,
            "target":args.expected_display_name, "backup_mode":oct(snapshot_file.stat().st_mode & 0o777)
        },ensure_ascii=False))

        if not args.apply:
            conn.rollback()
            return

        # Atomic DDL + all data. A failure rolls everything back.
        with conn:
            with conn.cursor() as cur:
                cur.execute("set local lock_timeout='15s'")
                cur.execute("set local statement_timeout='60s'")
                cur.execute("select pg_advisory_xact_lock(hashtext('liubai-m4-to-cloud'))")
                if owner(cur, args.expected_display_name, args.expected_user_id, args.expected_username) != target:
                    raise ValueError("Target identity changed")
                sql = args.migration_file.read_text()
                digest = sha256(sql.encode()).hexdigest()
                cur.execute("""
                  select sha256 from ledger_ops.schema_migrations where name=%s
                """, (args.migration_file.name,))
                row = cur.fetchone()
                if row and row[0] != digest:
                    raise ValueError("Migration hash mismatch")
                if not row:
                    cur.execute(sql)
                    cur.execute("""
                      insert into ledger_ops.schema_migrations(name,sha256) values (%s,%s)
                    """, (args.migration_file.name,digest))

                cur.execute("""
                  select count(*) from public.ledger_transactions
                  where user_id=%s and legacy_id is null
                """, (str(target),))
                target_preexisting_nonlegacy = cur.fetchone()[0]
                expected_nonlegacy = sum(not r.get("legacy_id") for r in before["ledger_transactions"])
                if target_preexisting_nonlegacy != expected_nonlegacy:
                    raise ValueError("Unexpected changes to preexisting target transactions")

                cats = {}
                for c in source["categories"]:
                    cur.execute("""
                      insert into public.ledger_categories(user_id,name,slug)
                      values (%s,%s,%s) on conflict (user_id,slug)
                      do update set name=excluded.name returning id
                    """, (str(target),c["name"],c["slug"]))
                    cats[c["id"]] = cur.fetchone()[0]

                accounts = {}
                for a in source["funding_accounts"]:
                    kind = ACCOUNT_TYPES[a["type"]]
                    cur.execute("""
                      insert into public.ledger_accounts(user_id,name,type,issuer,currency)
                      values (%s,%s,%s,%s,%s)
                      on conflict (user_id,name) do update
                      set type=excluded.type,issuer=excluded.issuer,currency=excluded.currency
                      returning id
                    """, (str(target),a["nickname"],kind,a.get("issuer"),a["currency"]))
                    accounts[a["id"]] = cur.fetchone()[0]

                imported_now = 0
                for tx in src_txs:
                    legacy_id = tx["id"]
                    request_id = "legacy_m4_" + sha256(legacy_id.encode()).hexdigest()[:32]
                    cloud_id = uuid5(NAMESPACE_URL,f"liubai-ledger-m4/{target}/{legacy_id}")
                    # M4 backfills often contain import time in occurred_at rather
                    # than purchase time; anchor only the known calendar day.
                    day = date.fromisoformat(tx["date"])
                    calendar_anchor = datetime.combine(day,time(12),tzinfo=ZoneInfo("Asia/Taipei"))
                    cur.execute("""
                      insert into public.ledger_transactions (
                        id,user_id,device_id,request_id,source,amount_minor,currency,
                        occurred_at,merchant,merchant_normalized,card_label,status,
                        account_id,category_id,note,
                        legacy_id,legacy_date,legacy_kind,legacy_description,legacy_is_recurring
                      ) values (
                        %s,%s,null,%s,%s,%s,%s,
                        %s,%s,%s,%s,'confirmed',
                        %s,%s,%s,
                        %s,%s,%s,%s,%s
                      )
                      on conflict (user_id, request_id) do nothing
                      returning id
                    """,(
                      str(cloud_id),str(target),request_id,tx["source"],tx["amount"],tx["currency"],
                      calendar_anchor,tx.get("merchant") or tx["description"],
                      tx.get("merchant_normalized") or (tx.get("merchant") or tx["description"]).lower(),
                      next(a["nickname"] for a in source["funding_accounts"] if a["id"]==tx["funding_account_id"]),
                      accounts[tx["funding_account_id"]],
                      cats.get(tx.get("category_id")),
                      tx.get("notes"),legacy_id,day,tx["kind"],tx.get("description"),
                      bool(tx.get("is_recurring")),
                    ))
                    inserted = cur.fetchone()
                    if inserted:
                        imported_now += 1
                    else:
                        cur.execute("""
                          select id,amount_minor,legacy_date,legacy_id
                          from public.ledger_transactions
                          where user_id=%s and request_id=%s
                        """, (str(target),request_id))
                        existing = cur.fetchone()
                        if not existing or str(existing[0])!=str(cloud_id) or existing[1]!=tx["amount"] or str(existing[2])!=tx["date"] or existing[3]!=legacy_id:
                            raise ValueError("Conflicting existing imported transaction")

                    cur.execute("""
                      insert into ledger_ops.legacy_tx_provenance(user_id,legacy_id,cloud_tx_id,original)
                      values (%s,%s,%s,%s::jsonb)
                      on conflict(user_id,legacy_id) do nothing
                    """, (str(target),legacy_id,str(cloud_id),
                          json.dumps(tx,ensure_ascii=False,allow_nan=False)))

                after = metrics(cur,target)
                if (after["count"],after["unique_legacy_ids"],after["provenance_count"],after["sum_minor"]) != (
                   len(src_txs),len(src_txs),len(src_txs),expected_total):
                    raise ValueError("Post-import integrity check failed")
                if {d:int(total) for d,n,total in after["daily"]} != dict(source_by_day):
                    raise ValueError("Transaction-day amount reconciliation failed")
                cur.execute("select count(*) from public.ledger_transactions where user_id<>%s", (str(target),))
                if cur.fetchone()[0] != others_before:
                    raise ValueError("Another tenant changed during migration")
                cur.execute("notify pgrst, 'reload schema'")
                print("PRECOMMIT_VERIFIED", json.dumps({
                    "target":args.expected_display_name, "new_rows":imported_now,
                    "cloud_rows":after["count"], "sum_minor":after["sum_minor"],
                    "provenance":after["provenance_count"], "distinct_dates":len(after["daily"]),
                    "other_users_unchanged":True},ensure_ascii=False))
        with conn.cursor() as cur:
            cur.execute("select user_id from public.ledger_profiles where username_display=%s", (args.expected_display_name,))
            after = metrics(cur,target)
        dump_private(args.output_dir/"migration-result.json",{
            "status":"COMMITTED_AND_VERIFIED", "target":args.expected_display_name,
            "new_rows":imported_now, "before_snapshot":snapshot_file.name,
            "source_sha256":sha256(source_bytes).hexdigest(),
            "postflight":after,"at_utc":datetime.now(timezone.utc).isoformat()
        })
        print("SUCCESS_COMMITTED",{"count":after["count"],"total_minor":after["sum_minor"]})
    finally:
        conn.close()


if __name__ == "__main__":
    main()
