-- flightcheck v0.1 -- scoring progress stage (additive, idempotent).
-- Apply via the Supabase SQL editor, after 001_init.sql.
--
-- sessions.scoring_stage is the worker's coarse progress marker while
-- status = 'scoring' ("download" -> "transcribe" -> "delivery-metrics" ->
-- "content-judge" -> "delivery-judge" -> "compile"); the terminal status
-- writes ("scored"/"failed") clear it back to null.

alter table sessions add column if not exists scoring_stage text;
