-- Liubai Ledger SaaS core — multi-tenant free beta primitives.
-- Builds on 202609230001_cloud_v2.sql. Browser sessions stay read-only;
-- authenticated writes are mediated by /api/v2 server handlers.

create table if not exists public.ledger_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  locale text not null default 'zh-TW',
  timezone text not null default 'Asia/Taipei',
  plan text not null default 'free' check (plan in ('free')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'card'
    check (type in ('card','cash','bank','wallet','other')),
  issuer text,
  currency char(3) not null default 'TWD',
  card_aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists ledger_accounts_user_idx
  on public.ledger_accounts(user_id, created_at);

create table if not exists public.ledger_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists ledger_categories_user_idx
  on public.ledger_categories(user_id, name);

alter table public.ledger_transactions
  add column if not exists account_id uuid references public.ledger_accounts(id) on delete set null,
  add column if not exists category_id uuid references public.ledger_categories(id) on delete set null,
  add column if not exists note text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.ledger_profiles enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_categories enable row level security;

revoke all on public.ledger_profiles from anon, authenticated;
revoke all on public.ledger_accounts from anon, authenticated;
revoke all on public.ledger_categories from anon, authenticated;

grant select on public.ledger_profiles to authenticated;
grant select on public.ledger_accounts to authenticated;
grant select on public.ledger_categories to authenticated;

create policy "users read own profile"
  on public.ledger_profiles for select
  to authenticated
  using (user_id = auth.uid());

create policy "users read own accounts"
  on public.ledger_accounts for select
  to authenticated
  using (user_id = auth.uid());

create policy "users read own categories"
  on public.ledger_categories for select
  to authenticated
  using (user_id = auth.uid());

-- Existing transaction policy already scopes rows by auth.uid(); the new
-- account/category foreign keys never weaken that boundary.
