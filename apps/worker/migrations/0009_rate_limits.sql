-- Fixed-window rate-limit counters (issue #76).
-- IMPORTANT: this file MUST stay pure ASCII (no em-dashes or smart quotes).
-- The test migration loader ships SQL via a Latin1 header and a non-ASCII char
-- crashes the vitest pool.
--
-- We deliberately do NOT use the Cloudflare native "unsafe" ratelimit binding:
-- it is not reliably available under @cloudflare/vitest-pool-workers (miniflare),
-- so a D1-backed limiter keeps the limiter testable in the same pool that runs
-- the rest of the worker suite.
--
-- One row per (limiter key, fixed window). `key` encodes the protected surface
-- plus the principal, e.g. "uploads:create:user_123" or "invites:lookup:ip_1.2.3.4".
-- `window_start` is the integer window index (floor(now / window_seconds)), so a
-- new window simply lands on a fresh (key, window_start) row. Stale rows from old
-- windows are harmless leftovers; a later cleanup pass can prune them.
CREATE TABLE rate_limits (
  key          TEXT    NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
