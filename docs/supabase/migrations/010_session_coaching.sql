-- F-73: post-session coaching artifacts (DECISIONS 049). Columns on
-- sessions, mirroring transcript (004): they ride session deletion and
-- are EXCLUDED from SESSION_COLUMNS so no poll ever carries them.
-- paraphrases/insights are generated artifacts; paraphrase_marks is the
-- customer's own state (reactions, bookmarks) and a regeneration must
-- never touch it — separate columns is that guarantee.
alter table sessions add column if not exists paraphrases jsonb;
alter table sessions add column if not exists insights jsonb;
alter table sessions add column if not exists paraphrase_marks jsonb;
