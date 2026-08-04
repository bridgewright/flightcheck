-- v0.8 F-47: a running room's liveness clock.
-- NULL preserves the pre-heartbeat hard-cut behavior for existing sessions.

alter table sessions
  add column if not exists last_heartbeat_at timestamptz;

create index if not exists sessions_live_heartbeat_idx
  on sessions (package_id, last_heartbeat_at)
  where status = 'planned' and last_heartbeat_at is not null;
