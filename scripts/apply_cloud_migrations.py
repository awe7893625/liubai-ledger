"""Apply Ledger cloud migrations to an explicitly identified Supabase project.

Secrets are read from an ignored dotenv file and never printed. Migrations are
tracked by name + SHA-256 under ledger_ops.schema_migrations.
"""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from urllib.parse import urlparse

import psycopg2
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "cloud" / "supabase" / "migrations"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", required=True)
    parser.add_argument("--expected-project-ref", required=True)
    parser.add_argument("--sslrootcert", required=True)
    args = parser.parse_args()

    env = dotenv_values(args.env_file)
    supabase_url = str(env.get("SUPABASE_URL") or "")
    dsn = str(env.get("POSTGRES_URL_NON_POOLING") or "")
    ref = args.expected_project_ref
    if urlparse(supabase_url).hostname != f"{ref}.supabase.co":
        raise RuntimeError("Supabase project identity mismatch")
    if ref not in (urlparse(dsn).username or ""):
        raise RuntimeError("Postgres project identity mismatch")

    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        raise RuntimeError("No migrations found")

    conn = psycopg2.connect(
        dsn,
        sslmode="verify-full",
        sslrootcert=str(Path(args.sslrootcert).resolve()),
        connect_timeout=15,
    )
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("select pg_advisory_xact_lock(hashtext('liubai-ledger-cloud-migrations'))")
                cur.execute("create schema if not exists ledger_ops")
                cur.execute("revoke all on schema ledger_ops from public, anon, authenticated")
                cur.execute(
                    "create table if not exists ledger_ops.schema_migrations ("
                    "name text primary key, sha256 text not null, applied_at timestamptz not null default now())"
                )
                for path in files:
                    raw = path.read_text()
                    digest = hashlib.sha256(raw.encode()).hexdigest()
                    cur.execute(
                        "select sha256 from ledger_ops.schema_migrations where name=%s",
                        (path.name,),
                    )
                    existing = cur.fetchone()
                    if existing:
                        if existing[0] != digest:
                            raise RuntimeError(f"Migration hash mismatch: {path.name}")
                        print(f"SKIP {path.name}")
                        continue
                    cur.execute(raw)
                    cur.execute(
                        "insert into ledger_ops.schema_migrations(name,sha256) values (%s,%s)",
                        (path.name, digest),
                    )
                    print(f"APPLY {path.name}")
                cur.execute("notify pgrst, 'reload schema'")
        print(f"PASS migrations={len(files)} project={ref}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
