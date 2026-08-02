-- Complete-webapp batch (WP-A): persist the verbatim session transcript.
-- Additive and idempotent; apply via the Supabase SQL editor after 003.
--
-- sessions.transcript stores the bare list[TranscriptSegment] JSON
-- ([{start_s, end_s, speaker, text}, ...]) saved right after the
-- transcribe stage, so failed sessions keep their transcripts too.
alter table sessions add column if not exists transcript jsonb;
