-- Persist monthly plans per owner/month/currency; no existing ledger rows changed.
create table if not exists public.ledger_budgets (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_month text not null check (period_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  total_limit_minor bigint not null check (total_limit_minor between 0 and 9000000000000),
  safety_buffer_minor bigint not null default 0 check (safety_buffer_minor >= 0 and safety_buffer_minor <= total_limit_minor),
  category_limits jsonb not null default '{}'::jsonb
    check (jsonb_typeof(category_limits) = 'object' and octet_length(category_limits::text) <= 20000),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, period_month, currency)
);

alter table public.ledger_budgets enable row level security;
revoke all on public.ledger_budgets from public, anon, authenticated;
grant select on public.ledger_budgets to authenticated;
grant select, insert, update, delete on public.ledger_budgets to service_role;
create policy "users read own monthly budgets" on public.ledger_budgets for select
  to authenticated using ((select auth.uid()) = user_id);
comment on table public.ledger_budgets is
  'Server-mediated monthly budget writes with optimistic version checks; browser SELECT is owner-only.';
