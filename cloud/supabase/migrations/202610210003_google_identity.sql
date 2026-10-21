-- Liubai Ledger: private mapping from verified Google identity to Supabase user.
-- Browser roles receive no privileges; only server/service-role code uses this table.

create table if not exists public.ledger_google_identities (
  subject_hash text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

alter table public.ledger_google_identities enable row level security;
revoke all on public.ledger_google_identities from anon, authenticated;

create index if not exists ledger_google_identities_user_idx
  on public.ledger_google_identities(user_id);
