-- F-74: package-level study materials (DECISIONS 050). Its own table,
-- NOT a packages column: every package read is select("*"), and a
-- 30-60KB doc would ride every /home poll — the size class transcript
-- was engineered out of hot reads for. id IS the package id: one doc
-- per package by primary key, and delete_rows' by-id contract holds.
create table if not exists study_materials (
    id uuid primary key,
    status text not null,
    doc jsonb,
    generated_at timestamptz,
    updated_at timestamptz not null default now()
);
alter table study_materials enable row level security;
