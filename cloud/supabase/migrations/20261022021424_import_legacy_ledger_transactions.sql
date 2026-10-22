-- Historical M4 Ledger import, scoped by tenant. Never relax existing RLS.
-- The original source row is retained in an unexposed, server-only provenance table.
alter table public.ledger_transactions
  add column if not exists legacy_id text,
  add column if not exists legacy_date date,
  add column if not exists legacy_kind text,
  add column if not exists legacy_description text,
  add column if not exists legacy_is_recurring boolean;

create unique index if not exists ledger_transactions_user_legacy_id_idx
  on public.ledger_transactions (user_id, legacy_id)
  where legacy_id is not null;

alter table public.ledger_transactions
  drop constraint if exists ledger_transactions_source_check;
alter table public.ledger_transactions
  add constraint ledger_transactions_source_check
  check (source in ('apple_pay','manual','notification','statement','capture','email'));

alter table public.ledger_transactions
  add constraint ledger_transactions_legacy_kind_check
  check (legacy_kind is null or legacy_kind in ('income','expense','refund','transfer','unknown'));

create schema if not exists ledger_ops;
revoke all on schema ledger_ops from public, anon, authenticated;

create table if not exists ledger_ops.legacy_tx_provenance (
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text not null,
  cloud_tx_id uuid not null unique references public.ledger_transactions(id) on delete cascade,
  original jsonb not null,
  imported_at timestamptz not null default now(),
  primary key (user_id, legacy_id)
);

alter table ledger_ops.legacy_tx_provenance enable row level security;
revoke all on ledger_ops.legacy_tx_provenance from public, anon, authenticated;
comment on table ledger_ops.legacy_tx_provenance is
  'Non-exposed, audit-only original M4 Ledger rows. No REST browser grants.';
