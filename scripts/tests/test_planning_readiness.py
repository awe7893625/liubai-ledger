"""Unit tests for read-only schema guards. No database connection is created."""
import hashlib
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).resolve().parents[1] / 'check_planning_schema_ready.py'
spec = importlib.util.spec_from_file_location('planning_ready', PATH)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class Cursor:
    def __init__(self, mode='valid'):
        self.mode = mode; self.result = None; self.queries = []

    def execute(self, sql, args):
        self.queries.append(sql)
        if 'schema_migrations' in sql:
            name = args[0]
            digest = hashlib.sha256((m.ROOT/'cloud/supabase/migrations'/name).read_bytes()).hexdigest()
            self.result = None if self.mode == 'missing_followup' and name == m.NAMES[1] else ('bad' if self.mode == 'bad_digest' else digest,)
        elif 'rowsecurity' in sql:
            self.result = (self.mode != 'rls_off',)
        elif 'pg_constraint' in sql:
            rule = next(r for r in m.REFERENCES if r[1] == args[1]); field = rule[2]
            self.result = (True, ['user_id', field], 'public', rule[3], ['user_id', 'id'], 'n', [field])
            if self.mode == 'single_fk': self.result = (True, [field], 'public', rule[3], ['id'], 'n', [field])
            if self.mode == 'null_owner': self.result = (True, ['user_id', field], 'public', rule[3], ['user_id','id'], 'n', ['user_id',field])
            if self.mode == 'unvalidated': self.result = (False, *self.result[1:])
            if self.mode == 'wrong_schema': self.result = (True, ['user_id', field], 'other', rule[3], ['user_id','id'], 'n', [field])
        elif len(args) == 9:
            self.result = (self.mode == 'anon_read', self.mode != 'no_authenticated_read', True)
        else:
            self.result = (self.mode == 'browser_write' and args[0] == 'authenticated' and args[2] == 'UPDATE',)

    def fetchone(self): return self.result


class GuardTests(unittest.TestCase):
    def test_complete_contract_passes_and_queries_are_select_only(self):
        cursor = Cursor(); m.check_schema(cursor)
        self.assertTrue(all(sql.lstrip().lower().startswith('select') for sql in cursor.queries))
        self.assertEqual(sum('pg_constraint' in sql for sql in cursor.queries), 5)

    def test_missing_or_different_migrations_refuse_release(self):
        for mode in ('missing_followup','bad_digest'):
            with self.subTest(mode=mode), self.assertRaises(RuntimeError): m.check_schema(Cursor(mode))

    def test_rls_and_all_browser_privileges_are_enforced(self):
        for mode in ('rls_off','anon_read','no_authenticated_read','browser_write'):
            with self.subTest(mode=mode), self.assertRaises(RuntimeError): m.check_schema(Cursor(mode))

    def test_incomplete_foreign_key_and_delete_semantics_refuse_release(self):
        for mode in ('single_fk','null_owner','unvalidated','wrong_schema'):
            with self.subTest(mode=mode), self.assertRaises(RuntimeError): m.check_schema(Cursor(mode))


if __name__ == '__main__': unittest.main()
