"""Read-only deployment preflight; never applies DDL or changes user data.
Run only as part of an authorized deployment after the additive migration succeeds.
Missing migration, wrong project or excessive grants refuse deployment.
"""
from pathlib import Path
from urllib.parse import urlparse
import argparse
import hashlib
import psycopg2
from dotenv import dotenv_values

ROOT=Path(__file__).resolve().parents[1]
NAME='20261022101858_planning_and_preferences.sql'
TABLES=('ledger_preferences','ledger_scheduled_expenses','ledger_scheduled_receipts')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file',required=True)
    parser.add_argument('--sslrootcert',required=True)
    parser.add_argument('--expected-project-ref',required=True)
    args=parser.parse_args()
    env=dotenv_values(args.env_file);ref=args.expected_project_ref
    assert ref=='vhosvmnhdrzkhmkmptqg'
    assert urlparse(env['SUPABASE_URL']).hostname==ref+'.supabase.co'
    assert ref in (urlparse(env['POSTGRES_URL_NON_POOLING']).username or '')
    conn=psycopg2.connect(env['POSTGRES_URL_NON_POOLING'],sslmode='verify-full',sslrootcert=str(Path(args.sslrootcert).resolve()),connect_timeout=15)
    conn.set_session(readonly=True)
    try:
        with conn.cursor() as cursor:
            cursor.execute('select sha256 from ledger_ops.schema_migrations where name=%s',(NAME,))
            row=cursor.fetchone()
            digest=hashlib.sha256((ROOT/'cloud/supabase/migrations'/NAME).read_bytes()).hexdigest()
            if not row or row[0]!=digest:raise RuntimeError('Planning/preferences migration not confirmed; deployment refused')
            for table in TABLES:
                cursor.execute("select rowsecurity from pg_tables where schemaname='public' and tablename=%s",(table,))
                if cursor.fetchone()!=(True,):raise RuntimeError('RLS guard failed')
                cursor.execute('select has_table_privilege(%s,%s,%s),has_table_privilege(%s,%s,%s),has_table_privilege(%s,%s,%s)',
                    ('anon','public.'+table,'SELECT','authenticated','public.'+table,'INSERT','service_role','public.'+table,'INSERT'))
                if cursor.fetchone()!=(False,False,True):raise RuntimeError('Table privileges guard failed')
        print('PASS read-only planning schema deployment guard')
    finally:conn.close()

if __name__=='__main__':main()
