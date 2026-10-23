"""Read-only release preflight; never executes DDL, imports or account mutations.
Both reviewed migrations and structural tenant constraints are mandatory. This
check does not authorize applying a migration previously blocked by a tool.
"""
from pathlib import Path
from urllib.parse import urlparse
import argparse
import hashlib
import psycopg2
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
NAMES = (
    '20261022101858_planning_and_preferences.sql',
    '20261023074854_planning_reference_ownership.sql',
)
TABLES = ('ledger_preferences', 'ledger_scheduled_expenses', 'ledger_scheduled_receipts')
REFERENCES = (
    ('ledger_preferences', 'ledger_preferences_default_account_id_fkey', 'default_account_id', 'ledger_accounts'),
    ('ledger_preferences', 'ledger_preferences_default_category_id_fkey', 'default_category_id', 'ledger_categories'),
    ('ledger_scheduled_expenses', 'ledger_scheduled_expenses_account_id_fkey', 'account_id', 'ledger_accounts'),
    ('ledger_scheduled_expenses', 'ledger_scheduled_expenses_category_id_fkey', 'category_id', 'ledger_categories'),
    ('ledger_scheduled_receipts', 'ledger_scheduled_receipts_transaction_id_fkey', 'transaction_id', 'ledger_transactions'),
)


def check_schema(cursor):
    for name in NAMES:
        cursor.execute('select sha256 from ledger_ops.schema_migrations where name=%s', (name,))
        row = cursor.fetchone()
        digest = hashlib.sha256((ROOT/'cloud/supabase/migrations'/name).read_bytes()).hexdigest()
        if not row or row[0] != digest:
            raise RuntimeError('Required planning migration is unconfirmed; deployment refused')
    for table in TABLES:
        cursor.execute("select rowsecurity from pg_tables where schemaname='public' and tablename=%s", (table,))
        if cursor.fetchone() != (True,):
            raise RuntimeError('RLS guard failed')
        for role in ('anon', 'authenticated'):
            for privilege in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'):
                cursor.execute('select has_table_privilege(%s,%s,%s)', (role, 'public.'+table, privilege))
                if cursor.fetchone() != (False,):
                    raise RuntimeError('Browser mutation privilege guard failed')
        cursor.execute('select has_table_privilege(%s,%s,%s),has_table_privilege(%s,%s,%s),has_table_privilege(%s,%s,%s)',
                       ('anon', 'public.'+table, 'SELECT', 'authenticated', 'public.'+table, 'SELECT', 'service_role', 'public.'+table, 'INSERT'))
        if cursor.fetchone() != (False, True, True):
            raise RuntimeError('Read/server-write privilege guard failed')
    for table, constraint, field, referenced in REFERENCES:
        cursor.execute("""
          select c.convalidated,
            array(select a.attname::text from unnest(c.conkey) with ordinality k(attnum,ord)
                  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum order by k.ord),
            n.nspname::text, r.relname::text,
            array(select a.attname::text from unnest(c.confkey) with ordinality k(attnum,ord)
                  join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.attnum order by k.ord),
            c.confdeltype::text,
            array(select a.attname::text from unnest(c.confdelsetcols) with ordinality k(attnum,ord)
                  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum order by k.ord)
          from pg_constraint c join pg_class r on r.oid=c.confrelid
          join pg_namespace n on n.oid=r.relnamespace
          where c.conrelid=%s::regclass and c.conname=%s and c.contype='f'
        """, ('public.'+table, constraint))
        expected = (True, ['user_id', field], 'public', referenced, ['user_id', 'id'], 'n', [field])
        if cursor.fetchone() != expected:
            raise RuntimeError('Composite tenant reference/delete behavior guard failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--sslrootcert', required=True)
    parser.add_argument('--expected-project-ref', required=True)
    args = parser.parse_args()
    env = dotenv_values(args.env_file); ref = args.expected_project_ref
    if ref != 'vhosvmnhdrzkhmkmptqg' or urlparse(env['SUPABASE_URL']).hostname != ref+'.supabase.co' or ref not in (urlparse(env['POSTGRES_URL_NON_POOLING']).username or ''):
        raise RuntimeError('Project identity mismatch')
    conn = psycopg2.connect(env['POSTGRES_URL_NON_POOLING'], sslmode='verify-full',
                           sslrootcert=str(Path(args.sslrootcert).resolve()), connect_timeout=15)
    conn.set_session(readonly=True)
    try:
        with conn.cursor() as cursor:
            cursor.execute("set local statement_timeout='15s'")
            check_schema(cursor)
        print('PASS read-only planning schema + five composite ownership guards')
    finally:
        conn.close()


if __name__ == '__main__': main()
