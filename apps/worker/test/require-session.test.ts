import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedFetch, seedSession } from "./helpers/auth.js";

beforeAll(() => seedSession(env));

describe("requireSession middleware", () => {
  it("401s an authenticated route when no cookie is present", async () => {
    const res = await SELF.fetch("https://example.com/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("GET /api/me returns the seeded owner session", async () => {
    const res = await authedFetch("https://example.com/api/me");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      user: { id: "usr_dev", email: "aphisak@mohara.co" },
      project_id: "proj_evo",
      environment_id: "env_evo_staging",
      role: "owner",
    });
  });

  it("401s when the cookie token is tampered (KV miss)", async () => {
    const res = await authedFetch("https://example.com/api/me", {}, "not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("/api/health stays open without a cookie", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("logout deletes the KV session so a follow-up /api/me 401s", async () => {
    await seedSession(env, { token: "logout-token" });

    // Session is live first.
    const before = await authedFetch("https://example.com/api/me", {}, "logout-token");
    expect(before.status).toBe(200);

    const logout = await authedFetch(
      "https://example.com/api/auth/logout",
      { method: "POST" },
      "logout-token",
    );
    expect(logout.status).toBe(204);

    const after = await authedFetch("https://example.com/api/me", {}, "logout-token");
    expect(after.status).toBe(401);
  });

  it("bumps the KV TTL (rolling window) on each authenticated request", async () => {
    await seedSession(env, { token: "rolling-token" });

    // Manually shrink expires_at to simulate a session nearing the end of its
    // window, then make a request and assert the row was re-written forward.
    const past = Math.floor(Date.now() / 1000) + 60;
    await env.SESSIONS.put(
      "session:rolling-token",
      JSON.stringify({
        user_id: "usr_dev",
        project_id: "proj_evo",
        environment_id: "env_evo_staging",
        role: "owner",
        expires_at: past,
      }),
    );

    const res = await authedFetch("https://example.com/api/me", {}, "rolling-token");
    expect(res.status).toBe(200);

    const raw = await env.SESSIONS.get("session:rolling-token");
    expect(raw).not.toBeNull();
    const row = JSON.parse(raw!) as { expires_at: number };
    // After the request, expires_at must have rolled well past the shrunk value.
    expect(row.expires_at).toBeGreaterThan(past + 1000);
  });
});
