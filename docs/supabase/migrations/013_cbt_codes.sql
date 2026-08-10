-- v0.17 F-87: closed-beta access without inventing payment.
--
-- Codes are stored only as normalized SHA-256 hashes. The redemption row is
-- the durable entitlement counter: counting live packages would let deletion
-- refund a grant and turn one shared code into unlimited free packages.

create table if not exists cbt_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text unique not null,
  label text not null,
  max_redemptions int not null,
  package_expires_at timestamptz not null,
  disabled_at timestamptz,
  created_at timestamptz default now()
);
alter table cbt_codes enable row level security;

create table if not exists cbt_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references cbt_codes(id),
  user_id uuid unique not null,
  packages_granted int not null default 0,
  redeemed_at timestamptz default now()
);
alter table cbt_redemptions enable row level security;
create index if not exists cbt_redemptions_code_id_idx
  on cbt_redemptions(code_id);

alter table packages add column if not exists cbt_code_id uuid;
