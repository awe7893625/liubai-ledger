-- Liubai Ledger Cloud v2 — isolated cloud schema.
-- This migration never touches the legacy FastAPI/SQLite ledger.
create extension if not exists pgcrypto;

create table if not exists public.ledger_pair_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticket_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ledger_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'iPhone',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index if not exists ledger_devices_user_idx
  on public.ledger_devices(user_id, created_at desc);
create table if not exists public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.ledger_devices(id) on delete set null,
  request_id text not null,
  source text not null default 'apple_pay'
    check (source in ('apple_pay','manual','notification','statement')),
  amount_minor bigint,
  currency char(3) not null default 'TWD',
  occurred_at timestamptz not null default now(),
  merchant text,
  merchant_normalized text,
  card_label text,
  status text not null default 'pending'
    check (status in ('pending','confirmed','duplicate','error')),
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists ledger_transactions_user_time_idx
  on public.ledger_transactions(user_id, occurred_at desc);

create table if not exists public.ledger_wallet_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.ledger_devices(id) on delete cascade,
  request_id text not null,
  amount_minor bigint,
  currency char(3) not null default 'TWD',
  merchant_raw text,
  card_raw text,
  occurred_at timestamptz,
  status text not null default 'received'
    check (status in ('received','processed','needs_review','duplicate','error')),
  transaction_id uuid references public.ledger_transactions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create index if not exists ledger_wallet_events_user_time_idx
  on public.ledger_wallet_events(user_id, received_at desc);

alter table public.ledger_pair_tickets enable row level security;
alter table public.ledger_devices enable row level security;
alter table public.ledger_transactions enable row level security;
alter table public.ledger_wallet_events enable row level security;

-- Browser sessions get read-only access to their own data. All writes are
-- mediated by Edge Functions so clients cannot change device tokens, ownership,
-- source fields, request ids, or pairing state directly.
revoke all on public.ledger_pair_tickets from anon, authenticated;
revoke all on public.ledger_devices from anon, authenticated;
revoke all on public.ledger_transactions from anon, authenticated;
revoke all on public.ledger_wallet_events from anon, authenticated;

grant select on public.ledger_devices to authenticated;
grant select on public.ledger_transactions to authenticated;
grant select on public.ledger_wallet_events to authenticated;

create policy "users read own devices"
  on public.ledger_devices for select
  to authenticated
  using (user_id = auth.uid());

create policy "users read own transactions"
  on public.ledger_transactions for select
  to authenticated
  using (user_id = auth.uid());

create policy "users read own wallet events"
  on public.ledger_wallet_events for select
  to authenticated
  using (user_id = auth.uid());
