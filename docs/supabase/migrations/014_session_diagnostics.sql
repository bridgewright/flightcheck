-- 014: the room's black box survives the room (F-67 Phase 0, DECISIONS 072).
-- Room diagnostic trail lines, appended by heartbeat deltas and capped
-- server-side (32 KB, newest tail kept). Tags and millisecond offsets only:
-- no audio, no transcript, no speech content. Deleted with the session row.
-- The column joins no API read payload; the operator reads it by SQL when a
-- recurrence needs it.
alter table sessions add column diagnostics text;
