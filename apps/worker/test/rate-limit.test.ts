import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env, Variables } from "../src/env.js";
import { inviteIpKey, rateLimit } from "../src/middleware/rate-limit.js";

/**
 * Builds a throwaway Hono app that mounts the limiter on `GET /probe` with the
 * given options, so each test drives a deterministic number of requests through
 * a single low-limit window. Real `env.DB` (with migration 0009 applied in
 * beforeAll) backs the counter.
 */
function probeApp(opts: { limit: number; windowSeconds: number; key: string }) {
  return new Hono<{ Bindings: Env; Variables: Variables }>().get(
    "/probe",
    rateLimit({ limit: opts.limit, windowSeconds: opts.windowSeconds, keyFn: () => opts.key }),
    (c) => c.json({ ok: true }),
  );
}

/** Unique key per test so suite-shared D1 storage never cross-contaminates. */
function uniqueKey(label: string) {
  return `test:${label}:${crypto.randomUUID()}`;
}

describe("rateLimit middleware", () => {
  it("allows requests up to the limit, then 429s", async () => {
    const key = uniqueKey("basic");
    const app = probeApp({ limit: 3, windowSeconds: 60, key });

    // First `limit` requests pass.
    for (let i = 0; i < 3; i++) {
      const res = await app.request("https://example.com/probe", {}, env);
      expect(res.status).toBe(200);
    }

    // The next one trips the limit.
    const tripped = await app.request("https://example.com/probe", {}, env);
    expect(tripped.status).toBe(429);
    expect(await tripped.json()).toEqual({ error: "Rate limit exceeded" });
  });

  it("stays green for any number of requests under the limit", async () => {
    const key = uniqueKey("under");
    const app = probeApp({ limit: 100, windowSeconds: 60, key });

    for (let i = 0; i < 20; i++) {
      const res = await app.request("https://example.com/probe", {}, env);
      expect(res.status).toBe(200);
    }
  });

  it("isolates counters per key", async () => {
    const keyA = uniqueKey("iso-a");
    const keyB = uniqueKey("iso-b");
    const appA = probeApp({ limit: 1, windowSeconds: 60, key: keyA });
    const appB = probeApp({ limit: 1, windowSeconds: 60, key: keyB });

    expect((await appA.request("https://example.com/probe", {}, env)).status).toBe(200);
    // keyA is now exhausted...
    expect((await appA.request("https://example.com/probe", {}, env)).status).toBe(429);
    // ...but keyB has its own budget.
    expect((await appB.request("https://example.com/probe", {}, env)).status).toBe(200);
  });

  it("separates windows so a new window resets the counter", async () => {
    const key = uniqueKey("window");
    // 1-second windows: count > limit only within the same floor(now/1) bucket.
    const app = probeApp({ limit: 1, windowSeconds: 1, key });

    const first = await app.request("https://example.com/probe", {}, env);
    expect(first.status).toBe(200);

    // Wait out the current 1-second window so the next request lands in a fresh
    // (key, window_start) row with its own count.
    await new Promise((r) => setTimeout(r, 1100));
    const nextWindow = await app.request("https://example.com/probe", {}, env);
    expect(nextWindow.status).toBe(200);
  });
});

describe("inviteIpKey", () => {
  it("uses CF-Connecting-IP when present", () => {
    const c = {
      req: { header: (name: string) => (name === "CF-Connecting-IP" ? "203.0.113.7" : undefined) },
    } as unknown as Parameters<typeof inviteIpKey>[0];
    expect(inviteIpKey(c)).toBe("invites:lookup:ip_203.0.113.7");
  });

  it("falls back to a constant when the header is absent", () => {
    const c = {
      req: { header: () => undefined },
    } as unknown as Parameters<typeof inviteIpKey>[0];
    expect(inviteIpKey(c)).toBe("invites:lookup:ip_unknown");
  });
});
