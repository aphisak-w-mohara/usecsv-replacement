import type { Context, MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";

type RateLimitCtx = Context<{ Bindings: Env; Variables: Variables }>;

export type RateLimitOptions = {
  /** Max requests allowed per key within a single window. */
  limit: number;
  /**
   * Window length in seconds. The window start is the epoch-second timestamp at
   * the start of the current window: `floor(now / windowSeconds) * windowSeconds`.
   * Storing an absolute timestamp (not a bare index) keeps stale-row cleanup
   * comparable across limiters that use different window sizes.
   */
  windowSeconds: number;
  /**
   * Derives the per-request limiter key from the request context. The returned
   * string should encode both the protected surface and the principal, e.g.
   * `uploads:create:user_123` or `invites:lookup:ip_1.2.3.4`, so unrelated
   * surfaces never share a counter.
   */
  keyFn: (c: RateLimitCtx) => string;
};

/**
 * D1-backed fixed-window rate limiter (issue #76).
 *
 * Each request computes the current fixed window (`floor(now / windowSeconds)`)
 * and atomically increments the per-key counter for that window via an upsert
 * (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`). Once the returned
 * count exceeds `limit`, the request is rejected with HTTP 429.
 *
 * We deliberately avoid the Cloudflare native "unsafe" ratelimit binding so the
 * limiter stays testable under @cloudflare/vitest-pool-workers (miniflare),
 * which does not reliably expose that binding. Stale rows from past windows are
 * pruned off the hot path by the scheduled cron (see purgeStaleRateLimits in
 * lib/retention.ts), not deleted per-request.
 *
 * Fails open: if the D1 write throws, the request is allowed through. A limiter
 * outage must not take down legitimate traffic.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> {
  const { limit, windowSeconds, keyFn } = options;

  return async (c, next) => {
    const key = keyFn(c);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;

    try {
      const row = await c.env.DB.prepare(
        `INSERT INTO rate_limits (key, window_start, count)
         VALUES (?, ?, 1)
         ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
        .bind(key, windowStart)
        .first<{ count: number }>();

      if (row && row.count > limit) {
        return c.json({ error: "Rate limit exceeded" }, 429);
      }
    } catch (err) {
      // Fail open: never let a limiter-storage hiccup block real traffic.
      console.error("rateLimit: DB error, allowing request through:", err);
    }

    await next();
  };
}

/** Fallback principal when `CF-Connecting-IP` is absent (local/dev/test). */
const UNKNOWN_IP = "unknown";

/**
 * Per-client-IP key for the public, pre-auth invite lookup. Reads the
 * Cloudflare edge header `CF-Connecting-IP`; falls back to a constant so the
 * limiter still functions locally and in tests (where the header is absent).
 */
export function inviteIpKey(c: RateLimitCtx): string {
  const ip = c.req.header("CF-Connecting-IP") ?? UNKNOWN_IP;
  return `invites:lookup:ip_${ip}`;
}
