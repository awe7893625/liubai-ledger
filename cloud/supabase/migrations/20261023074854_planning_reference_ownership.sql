-- Follow-up to the still-pending planning/preferences migration.
-- Does not copy/import/update/delete financial rows. Existing invalid references
-- fail the migration rather than being silently reassigned or removed.
-- PostgreSQL 17 supports SET NULL on only the nullable reference column.
create unique index if not exists ledger_accounts_owner_reference_idx
  on public.ledger_accounts(user_id,id);
create unique index if not exists ledger_categories_owner_reference_idx
  on public.ledger_categories(user_id,id);
create unique index if not exists ledger_transactions_owner_reference_idx
  on public.ledger_transactions(user_id,id);

alter table public.ledger_preferences
  drop constraint if exists ledger_preferences_default_account_id_fkey,
  drop constraint if exists ledger_preferences_default_category_id_fkey;
alter table public.ledger_preferences
  add constraint ledger_preferences_default_account_id_fkey
    foreign key (user_id,default_account_id)
    references public.ledger_accounts(user_id,id)
    on delete set null (default_account_id),
  add constraint ledger_preferences_default_category_id_fkey
    foreign key (user_id,default_category_id)
    references public.ledger_categories(user_id,id)
    on delete set null (default_category_id);

alter table public.ledger_scheduled_expenses
  drop constraint if exists ledger_scheduled_expenses_account_id_fkey,
  drop constraint if exists ledger_scheduled_expenses_category_id_fkey;
alter table public.ledger_scheduled_expenses
  add constraint ledger_scheduled_expenses_account_id_fkey
    foreign key (user_id,account_id)
    references public.ledger_accounts(user_id,id)
    on delete set null (account_id),
  add constraint ledger_scheduled_expenses_category_id_fkey
    foreign key (user_id,category_id)
    references public.ledger_categories(user_id,id)
    on delete set null (category_id);

alter table public.ledger_scheduled_receipts
  drop constraint if exists ledger_scheduled_receipts_transaction_id_fkey;
alter table public.ledger_scheduled_receipts
  add constraint ledger_scheduled_receipts_transaction_id_fkey
    foreign key (user_id,transaction_id)
    references public.ledger_transactions(user_id,id)
    on delete set null (transaction_id);

-- RLS, browser grants, auth identity and existing application write paths remain unchanged.
