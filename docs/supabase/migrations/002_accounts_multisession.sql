-- v0.4 (F-07): accounts + multi-session packages.
-- Applied to production 2026-08-02 (Supabase migration
-- "f07_accounts_multisession"); this file mirrors it for reproducibility.
alter table public.packages
  add column if not exists user_id uuid references auth.users (id),
  add column if not exists total_sessions int not null default 6;
create index if not exists packages_user_id_idx on public.packages (user_id);
create unique index if not exists sessions_package_index_unique
  on public.sessions (package_id, "index");
