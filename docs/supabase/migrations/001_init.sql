-- flightcheck v0.1 -- initial schema (Plan 2, Task 2).
-- Apply via the Supabase SQL editor. These tables are accessed only from
-- server-side code holding the service-role key (which bypasses RLS);
-- RLS is enabled with no policies so anon/authenticated keys can read nothing.
--
-- Storage buckets are created in the Supabase dashboard, NOT in SQL:
--   * "recordings" (private) - session audio uploaded by the web app
--     (path convention: packages/{package_id}/session-{index}.webm)
--   * "corpus" (private) - confidential rubric corpus (*.md at the root)
--     plus few-shot rubrics under the fewshot/ prefix (*.json); never
--     committed to the public repo (workspace rule R3). Local dev:
--     SCORER_CORPUS_DIR.

create table if not exists packages (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    access_token text unique not null,
    status text not null,               -- "compiling" -> "ready" | "failed"
    jd_text text,
    jd_url text,
    candidate_profile jsonb,            -- scorer.schemas.CandidateProfile
    rubric jsonb                        -- scorer.schemas.Rubric
);

create table if not exists sessions (
    id uuid primary key default gen_random_uuid(),
    package_id uuid not null references packages(id),
    "index" int not null,               -- 1-based session number within a package
    status text not null,               -- "planned" -> "scoring" -> "scored" | "failed"
    session_plan jsonb,                 -- scorer.schemas.SessionPlan
    audio_path text,                    -- Storage path in bucket "recordings"
    report jsonb,                       -- scorer.schemas.SessionReport
    created_at timestamptz not null default now()
);

create index if not exists sessions_package_id_idx on sessions (package_id);

alter table packages enable row level security;
alter table sessions enable row level security;
