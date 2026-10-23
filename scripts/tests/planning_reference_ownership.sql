-- Synthetic-only assertions; executed only in the network-none disposable container.
INSERT INTO public.ledger_accounts(id,user_id) VALUES
('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000002');
INSERT INTO public.ledger_categories(id,user_id) VALUES
('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000001'),
('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000002');
INSERT INTO public.ledger_transactions(id,user_id) VALUES
('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000002');
DO $$ BEGIN
 BEGIN
  UPDATE public.ledger_preferences SET default_account_id='00000000-0000-4000-8000-000000000031' WHERE user_id='00000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'foreign preference account accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.ledger_preferences SET default_category_id='00000000-0000-4000-8000-000000000041' WHERE user_id='00000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'foreign preference category accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.ledger_scheduled_expenses SET account_id='00000000-0000-4000-8000-000000000031' WHERE id='00000000-0000-4000-8000-000000000010';
  RAISE EXCEPTION 'foreign plan account accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.ledger_scheduled_expenses SET category_id='00000000-0000-4000-8000-000000000041' WHERE id='00000000-0000-4000-8000-000000000010';
  RAISE EXCEPTION 'foreign plan category accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  UPDATE public.ledger_scheduled_receipts SET transaction_id='00000000-0000-4000-8000-000000000050' WHERE plan_id='00000000-0000-4000-8000-000000000010';
  RAISE EXCEPTION 'foreign payment transaction accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
UPDATE public.ledger_preferences SET default_account_id='00000000-0000-4000-8000-000000000030',default_category_id='00000000-0000-4000-8000-000000000040' WHERE user_id='00000000-0000-4000-8000-000000000001';
UPDATE public.ledger_scheduled_expenses SET account_id='00000000-0000-4000-8000-000000000030',category_id='00000000-0000-4000-8000-000000000040' WHERE id='00000000-0000-4000-8000-000000000010';
DELETE FROM public.ledger_accounts WHERE id='00000000-0000-4000-8000-000000000030';
DELETE FROM public.ledger_categories WHERE id='00000000-0000-4000-8000-000000000040';
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.ledger_preferences WHERE user_id='00000000-0000-4000-8000-000000000001' AND default_account_id IS NULL AND default_category_id IS NULL) THEN RAISE EXCEPTION 'delete damaged preference owner'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.ledger_scheduled_expenses WHERE id='00000000-0000-4000-8000-000000000010' AND user_id='00000000-0000-4000-8000-000000000001' AND account_id IS NULL AND category_id IS NULL) THEN RAISE EXCEPTION 'delete damaged plan owner'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.ledger_scheduled_receipts WHERE plan_id='00000000-0000-4000-8000-000000000010' AND user_id='00000000-0000-4000-8000-000000000001' AND transaction_id IS NULL) THEN RAISE EXCEPTION 'delete damaged payment owner'; END IF;
END $$;
DO $$ DECLARE table_name text; role_name text; privilege_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['ledger_preferences','ledger_scheduled_expenses','ledger_scheduled_receipts'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
    IF has_table_privilege(role_name,'public.' || table_name,privilege_name) THEN RAISE EXCEPTION 'browser mutation grant'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
END $$;
SELECT 'PASS five composite owner references and selective SET NULL';
