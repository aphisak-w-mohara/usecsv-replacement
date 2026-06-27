import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { authedFetch } from "./helpers/auth.js";

/**
 * requireAuth in the `local` seam: identity is the `X-Dev-Email` header (test
 * env has ENVIRONMENT="local", so Firebase verification is skipped). The real
 * closed-signup gate then authorizes the email. Asserts the 401/403/200 contract
 * and the lazy invite-acceptance path (first authed request materializes the
 * membership).
 */
describe("requireAuth (local seam → closed-signup gate)", () => {
  // NOTE: the true "401 when not authenticated" path lives in the production
  // branch (no/invalid Bearer token), which can't run under ENVIRONMENT="local"
  // since the pool can't mint Google-signed tokens. firebase-token.test.ts
  // covers token rejection directly; here we exercise the local seam + gate.

  it("falls back to DEV_EMAIL (seeded owner) when no header is sent → 200", async () => {
    const res = await SELF.fetch("https://example.com/api/me");
    expect(res.status).toBe(200);
    const body = await res.json<{ user: { email: string } }>();
    expect(body.user.email).toBe("aphisak@mohara.co");
  });

  it("GET /api/me returns the seeded owner session for the owner email", async () => {
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

  it("403s an authed email with no membership and no matching invite", async () => {
    const res = await authedFetch("https://example.com/api/me", {}, "stranger@example.com");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Not authorized. Ask a project owner for an invite.",
    });
  });

  it("/api/health stays open without any auth", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("lazy invite acceptance (first authed request materializes membership)", () => {
  afterEach(async () => {
    // Keep the project's domain restriction clear for other tests.
    await env.DB.prepare(
      "UPDATE projects SET allowed_email_domain = NULL WHERE id = 'proj_evo'",
    ).run();
  });

  it("first authed request whose email matches a pending invite creates user + membership + accepted_at, then 200", async () => {
    const now = Math.floor(Date.now() / 1000);
    const email = "lazyinvitee@mohara.co";
    await env.DB.prepare(
      `INSERT INTO invites
         (id, project_id, email, role, token, invited_by, created_at, expires_at)
       VALUES ('inv_lazy', 'proj_evo', ?, 'member', 'tok_lazy', 'usr_dev', ?, ?)`,
    )
      .bind(email, now, now + 7 * 24 * 60 * 60)
      .run();

    // No user yet.
    const before = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    expect(before).toBeNull();

    // First authed request as the invited email.
    const res = await authedFetch("https://example.com/api/me", {}, email);
    expect(res.status).toBe(200);
    const me = await res.json<{ role: string; project_id: string }>();
    expect(me.role).toBe("member");
    expect(me.project_id).toBe("proj_evo");

    // A user row + membership at the invited role now exist.
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    expect(user).not.toBeNull();
    const membership = await env.DB.prepare(
      "SELECT role FROM memberships WHERE project_id = 'proj_evo' AND user_id = ?",
    )
      .bind(user!.id)
      .first<{ role: string }>();
    expect(membership?.role).toBe("member");

    // The invite is now accepted.
    const invite = await env.DB.prepare(
      "SELECT accepted_at FROM invites WHERE id = 'inv_lazy'",
    ).first<{ accepted_at: number | null }>();
    expect(invite?.accepted_at).not.toBeNull();

    // A second request reuses the materialized membership (still 200, no dup).
    const second = await authedFetch("https://example.com/api/me", {}, email);
    expect(second.status).toBe(200);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?")
      .bind(email)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("does not accept an expired invite → 403, no user row", async () => {
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    const email = "expiredinvitee@mohara.co";
    await env.DB.prepare(
      `INSERT INTO invites
         (id, project_id, email, role, token, invited_by, created_at, expires_at)
       VALUES ('inv_expired', 'proj_evo', ?, 'member', 'tok_expired', 'usr_dev', ?, ?)`,
    )
      .bind(email, eightDaysAgo - 1, eightDaysAgo)
      .run();

    const res = await authedFetch("https://example.com/api/me", {}, email);
    expect(res.status).toBe(403);

    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    expect(user).toBeNull();
  });

  it("rejects an in-invite email whose domain violates allowed_email_domain → 403", async () => {
    await env.DB.prepare(
      "UPDATE projects SET allowed_email_domain = 'mohara.co' WHERE id = 'proj_evo'",
    ).run();
    const now = Math.floor(Date.now() / 1000);
    const email = "outsider@otherco.com";
    await env.DB.prepare(
      `INSERT INTO invites
         (id, project_id, email, role, token, invited_by, created_at, expires_at)
       VALUES ('inv_outsider', 'proj_evo', ?, 'member', 'tok_outsider', 'usr_dev', ?, ?)`,
    )
      .bind(email, now, now + 7 * 24 * 60 * 60)
      .run();

    const res = await authedFetch("https://example.com/api/me", {}, email);
    expect(res.status).toBe(403);

    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    expect(user).toBeNull();
  });
});
