-- F-71: stored feedback (supersedes DECISIONS 040's mailto; its revisit
-- clause fired — DECISIONS 048). Rating is a HALF-STAR COUNT (1..10 =
-- 0.5..5.0 stars): an integer makes the 0.5 granularity a CHECK
-- constraint instead of a float-equality convention. package_id is
-- context, not a FK (orders precedent): deleting a package leaves the
-- feedback intact, pointing at an id that no longer resolves.
create table if not exists feedback (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    package_id uuid,
    rating_half_stars int not null
        check (rating_half_stars between 1 and 10),
    body text not null,
    status text not null default 'new',
    created_at timestamptz not null default now(),
    updated_at timestamptz
);
create index if not exists feedback_user_id_idx on feedback (user_id);
alter table feedback enable row level security;
