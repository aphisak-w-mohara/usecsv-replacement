-- Bookkeeping columns for the scheduled (cron) maintenance worker.
-- IMPORTANT: this file MUST stay pure ASCII (no em-dashes or smart quotes).
-- The test migration loader ships SQL via a Latin1 header and a non-ASCII char
-- crashes the vitest pool.
--
-- halt_alerted_at: unix seconds when an operator alert was sent for an upload
-- that reached status='halted'. NULL = not yet alerted. Set once so the cron
-- scan does not re-alert the same halted upload on every run.
ALTER TABLE uploads ADD COLUMN halt_alerted_at INTEGER;

-- payload_purged_at: unix seconds when this upload's batch payloads were nulled
-- out by the retention purge. NULL = payloads still present (or never had any).
-- Recorded once so a completed+old upload is not re-scanned every cron tick.
ALTER TABLE uploads ADD COLUMN payload_purged_at INTEGER;
