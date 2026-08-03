-- v0.5 payments batch (Phase 0): orders, trial/paid packages, 30-day expiry,
-- and per-session secret-mint accounting. Additive and idempotent; apply via
-- the Supabase SQL editor after 004.
--
-- * orders records every Polar order we provision from. polar_order_id is
--   UNIQUE so the order.paid webhook is idempotent: replaying the same event
--   can never provision twice.
-- * packages.is_trial marks the first package per account (1 session until
--   paid). paid_at/expires_at implement the 30-day window from payment;
--   order_id links back to the provisioning order. updated_at feeds the
--   stuck-state reaper (stale "compiling" detection).
-- * sessions.updated_at feeds the same reaper (stale "scoring" detection);
--   sessions.secret_mints counts realtime-secret mints so the web route can
--   cap them per session.

create table if not exists orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    package_id uuid not null,
    polar_order_id text unique not null,  -- webhook idempotency key
    polar_checkout_id text,
    amount_minor int,                     -- e.g. 4900 for $49.00
    currency text,
    status text,
    created_at timestamptz default now()
);

create index if not exists orders_user_id_idx on orders (user_id);

alter table orders enable row level security;

alter table packages
  add column if not exists is_trial boolean default false,
  add column if not exists paid_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists order_id uuid,
  add column if not exists updated_at timestamptz;

alter table sessions
  add column if not exists updated_at timestamptz,
  add column if not exists secret_mints int not null default 0;
