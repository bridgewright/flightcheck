-- v0.8 F-53: comped access, which is NOT a payment.
--
-- A comped package exposes its full session count without an order, for the
-- operator's own runs and for anyone else deliberately given access. It gets
-- its own column rather than a fabricated paid_at because paid_at is the money
-- anchor: writing it here would put revenue that never happened into every
-- query that counts paid packages, including the real-usage metrics the public
-- repo publishes.
--
-- NULL is the normal state. Nothing about existing rows changes.

alter table packages
  add column if not exists comped_at timestamptz;
