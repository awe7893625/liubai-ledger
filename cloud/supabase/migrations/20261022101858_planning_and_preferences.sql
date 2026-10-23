-- Additive only. Does not import, rewrite or delete any existing user transaction.
create table if not exists public.ledger_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  theme text not null default 'system' check (theme in ('system','light','dark')),
  home_currency text not null default 'TWD' check (home_currency ~ '^[A-Z]{3}$'),
  default_account_id uuid references public.ledger_accounts(id) on delete set null,
  default_category_id uuid references public.ledger_categories(id) on delete set null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_scheduled_expenses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9000000000000),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  recurrence text not null check (recurrence in ('once','monthly')),
  start_month text not null check (start_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  end_month text check (end_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' and end_month >= start_month),
  due_day integer not null check (due_day between 1 and 31),
  account_id uuid references public.ledger_accounts(id) on delete set null,
  category_id uuid references public.ledger_categories(id) on delete set null,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,id)
);
create index if not exists ledger_scheduled_expenses_owner_idx on public.ledger_scheduled_expenses(user_id,currency,start_month);

-- Linking is explicit; no bank charge and no new ledger transaction is created.
create table if not exists public.ledger_scheduled_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  period_month text not null check (period_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  status text not null check (status in ('linked','skipped','open')),
  transaction_id uuid references public.ledger_transactions(id) on delete set null,
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id,plan_id,period_month),
  foreign key (user_id,plan_id) references public.ledger_scheduled_expenses(user_id,id) on delete cascade,
  unique (user_id,transaction_id),
  check (status = 'linked' or transaction_id is null)
);

alter table public.ledger_preferences enable row level security;
alter table public.ledger_scheduled_expenses enable row level security;
alter table public.ledger_scheduled_receipts enable row level security;
revoke all on public.ledger_preferences, public.ledger_scheduled_expenses, public.ledger_scheduled_receipts from anon, authenticated;
grant select on public.ledger_preferences, public.ledger_scheduled_expenses, public.ledger_scheduled_receipts to authenticated;
grant all on public.ledger_preferences, public.ledger_scheduled_expenses, public.ledger_scheduled_receipts to service_role;
create policy "read own preferences" on public.ledger_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy "read own scheduled expenses" on public.ledger_scheduled_expenses for select to authenticated using (user_id = (select auth.uid()));
create policy "read own scheduled receipts" on public.ledger_scheduled_receipts for select to authenticated using (user_id = (select auth.uid()));
