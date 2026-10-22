"""Validate the additive schema in a throwaway, network-isolated PostgreSQL container.
No Supabase env file, private ledger or hosted database is accessed. Always removes
only this script's random-name container. Requires an already cached image.
"""
from pathlib import Path
import json
import secrets
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.004'
MIGRATION = ROOT / 'cloud/supabase/migrations/20261022101858_planning_and_preferences.sql'


def main():
    name='ledger-planning-qa-'+secrets.token_hex(6)
    password=secrets.token_hex(24)
    started=False
    def command(args, **kw):
        return subprocess.run(args, text=True, capture_output=True, timeout=60, **kw)
    try:
        result=command(['docker','run','--rm','--detach','--network','none','--memory','512m','--cpus','1',
            '--name',name,'--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_PASSWORD='+password,IMAGE])
        if result.returncode:raise RuntimeError('Isolated PostgreSQL did not start: '+result.stderr[:180])
        started=True
        for _ in range(30):
            ready=command(['docker','exec',name,'pg_isready','-U','postgres'])
            if ready.returncode==0:break
            time.sleep(1)
        else:raise RuntimeError('Isolated database not ready')
        scaffold="""
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users(id uuid primary key);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
CREATE TABLE public.ledger_accounts(id uuid primary key, user_id uuid references auth.users(id));
CREATE TABLE public.ledger_categories(id uuid primary key, user_id uuid references auth.users(id));
CREATE TABLE public.ledger_transactions(id uuid primary key, user_id uuid references auth.users(id));
"""
        checks="""
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO public.ledger_preferences(user_id,display_name) VALUES ('00000000-0000-4000-8000-000000000001','A'),('00000000-0000-4000-8000-000000000002','B');
INSERT INTO public.ledger_scheduled_expenses(id,user_id,name,amount_minor,currency,recurrence,start_month,due_day) VALUES
('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','A plan',10000,'TWD','monthly','2026-10',31),
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','A plan 2',10000,'TWD','monthly','2026-10',31),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','B plan',10000,'TWD','monthly','2026-10',31);
INSERT INTO public.ledger_transactions(id,user_id) VALUES ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001');
INSERT INTO public.ledger_scheduled_receipts(user_id,plan_id,period_month,status,transaction_id) VALUES
('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','2026-10','linked','00000000-0000-4000-8000-000000000020');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.ledger_scheduled_receipts(user_id,plan_id,period_month,status,transaction_id) VALUES
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','2026-10','linked','00000000-0000-4000-8000-000000000020');
  RAISE EXCEPTION 'duplicate payment accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.ledger_scheduled_receipts(user_id,plan_id,period_month,status) VALUES
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010','2026-10','open');
  RAISE EXCEPTION 'cross-owner plan reference accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
DELETE FROM public.ledger_transactions WHERE id='00000000-0000-4000-8000-000000000020';
DO $$ BEGIN
 IF (SELECT transaction_id IS NOT NULL FROM public.ledger_scheduled_receipts WHERE plan_id='00000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'payment delete did not clear link'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ledger_preferences)<>1 OR (SELECT display_name FROM public.ledger_preferences)<>'B' THEN RAISE EXCEPTION 'preference tenant leak'; END IF;
 IF (SELECT count(*) FROM public.ledger_scheduled_expenses)<>1 THEN RAISE EXCEPTION 'plan tenant leak'; END IF;
 IF (SELECT count(*) FROM public.ledger_scheduled_receipts)<>0 THEN RAISE EXCEPTION 'receipt tenant leak'; END IF;
 BEGIN
  UPDATE public.ledger_preferences SET display_name='NOT ALLOWED';
  RAISE EXCEPTION 'direct browser write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM count(*) FROM public.ledger_preferences; RAISE EXCEPTION 'anonymous read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS isolated schema constraints, payment unlink and RLS';
"""
        result=command(['docker','exec','-i',name,'psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'], input=scaffold+'\n'+MIGRATION.read_text()+'\n'+checks)
        if result.returncode:raise RuntimeError('Schema validation failed: '+result.stderr[-900:])
        print(json.dumps({'status':'PASS','database':'isolated container; network disabled','checks':['migration compiles','own-row RLS','anonymous reads denied','browser writes denied','unique payment link','cross-owner foreign key','deleted payment clears reference']},indent=2))
    finally:
        if started:
            result=command(['docker','rm','--force',name])
            if result.returncode:raise RuntimeError('Failed to remove isolated container '+name)
            print('CLEANUP isolated container removed')

if __name__=='__main__':main()
