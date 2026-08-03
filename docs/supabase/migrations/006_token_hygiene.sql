-- v0.6 "operate at scale" batch (Phase 0): capability-token hygiene columns.
-- Additive and idempotent; apply via the Supabase SQL editor after 005.
--
-- The room's package access_token is a permanent capability today: once it
-- leaks (RSC payload, browser history, a shared link) nothing can retire it.
-- These two columns give the worker somewhere to record a lifetime and a
-- revocation.
--
-- * sessions.access_token_expires_at — when the capability stops working.
--   NULL means "no expiry", which is exactly today's behaviour, so every
--   existing row keeps authorizing unchanged after this migration runs.
--   The mint-time default is a v0.6 Track C decision, not a schema default.
-- * sessions.token_revoked_at — when it was revoked by hand or by policy.
--   NULL means "never revoked".
--
-- Both nullable with no default on purpose: a backfill would silently
-- rewrite the access semantics of sessions a paying customer is mid-way
-- through.

alter table sessions
  add column if not exists access_token_expires_at timestamptz,
  add column if not exists token_revoked_at timestamptz;
