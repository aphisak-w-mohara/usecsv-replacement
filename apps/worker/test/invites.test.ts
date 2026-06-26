import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { authedFetch, seedSession } from "./helpers/auth.js";

beforeAll(() => seedSession(env));

const PROJECT = "proj_evo";

async function createInvite(body: unknown, token?: string) {
  return authedFetch(
    `https://example.com/api/projects/${PROJECT}/invites`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    token,
  );
}

describe("POST /api/projects/:id/invites", () => {
  it("creates an invite row and returns token + url scoped to the project", async () => {
    const res = await createInvite({ email: "NewHire@Mohara.co", role: "member" });
    expect(res.status).toBe(201);
    const body = await res.json<{ token: string; expires_at: number; invite_url: string }>();
    expect(body.token).toBeTruthy();
    expect(body.invite_url).toBe(`${env.APP_BASE_URL}/invites/${body.token}`);
    expect(body.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const row = await env.DB.prepare(
      "SELECT project_id, email, role, invited_by, accepted_at FROM invites WHERE token = ?",
    )
      .bind(body.token)
      .first<{
        project_id: string;
        email: string;
        role: string;
        invited_by: string;
        accepted_at: number | null;
      }>();
    expect(row).toMatchObject({
      project_id: PROJECT,
      email: "newhire@mohara.co", // lowercased
      role: "member",
      invited_by: "usr_dev",
      accepted_at: null,
    });
  });

  it("defaults role to member when omitted", async () => {
    const res = await createInvite({ email: "norole@mohara.co" });
    expect(res.status).toBe(201);
    const { token } = await res.json<{ token: string }>();
    const row = await env.DB.prepare("SELECT role FROM invites WHERE token = ?")
      .bind(token)
      .first<{ role: string }>();
    expect(row?.role).toBe("member");
  });

  it("rejects a duplicate pending invite for the same (project, email) → 409", async () => {
    const first = await createInvite({ email: "dup@mohara.co", role: "member" });
    expect(first.status).toBe(201);
    const second = await createInvite({ email: "dup@mohara.co", role: "member" });
    expect(second.status).toBe(409);
    const body = await second.json<{ error: string }>();
    expect(body.error).toMatch(/already pending/i);
  });

  it("rejects inviting an email that is already a member → 409", async () => {
    // usr_dev (aphisak@mohara.co) is the seeded owner/member of proj_evo.
    const res = await createInvite({ email: "aphisak@mohara.co", role: "member" });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/already a member/i);
  });

  it("returns 404 (not 403) for a cross-project id (IDOR)", async () => {
    const res = await authedFetch("https://example.com/api/projects/proj_other/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "x@mohara.co", role: "member" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:id/invites/:invite_id", () => {
  it("revokes a pending invite so the token no longer resolves", async () => {
    const created = await createInvite({ email: "revoke@mohara.co", role: "member" });
    const { token } = await created.json<{ token: string }>();
    const inviteRow = await env.DB.prepare("SELECT id FROM invites WHERE token = ?")
      .bind(token)
      .first<{ id: string }>();
    expect(inviteRow?.id).toBeTruthy();

    const del = await authedFetch(
      `https://example.com/api/projects/${PROJECT}/invites/${inviteRow!.id}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(204);

    const after = await env.DB.prepare("SELECT id FROM invites WHERE id = ?")
      .bind(inviteRow!.id)
      .first();
    expect(after).toBeNull();

    // Public lookup now 410s.
    const lookup = await fetchPublic(token);
    expect(lookup.status).toBe(410);
  });

  it("returns 400 when revoking an already-accepted invite", async () => {
    const created = await createInvite({ email: "accepted@mohara.co", role: "member" });
    const { token } = await created.json<{ token: string }>();
    const id = (
      await env.DB.prepare("SELECT id FROM invites WHERE token = ?").bind(token).first<{
        id: string;
      }>()
    )?.id;
    await env.DB.prepare("UPDATE invites SET accepted_at = unixepoch() WHERE id = ?")
      .bind(id)
      .run();

    const del = await authedFetch(
      `https://example.com/api/projects/${PROJECT}/invites/${id}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(400);
    const body = await del.json<{ error: string }>();
    expect(body.error).toMatch(/accepted invite/i);
  });

  it("returns 404 for an invite that isn't in the project", async () => {
    const del = await authedFetch(
      `https://example.com/api/projects/${PROJECT}/invites/inv_does_not_exist`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(404);
  });
});

describe("GET /api/projects/:id/invites", () => {
  it("lists only pending non-expired invites", async () => {
    const created = await createInvite({ email: "pending-list@mohara.co", role: "owner" });
    expect(created.status).toBe(201);

    const res = await authedFetch(`https://example.com/api/projects/${PROJECT}/invites`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      invites: { id: string; email: string; role: string; expires_at: number }[];
    }>();
    const found = body.invites.find((i) => i.email === "pending-list@mohara.co");
    expect(found).toMatchObject({ email: "pending-list@mohara.co", role: "owner" });
    // Accepted invites from earlier tests must not appear.
    expect(body.invites.some((i) => i.email === "accepted@mohara.co")).toBe(false);
  });
});

describe("GET /api/projects/:id/members", () => {
  it("lists current memberships joined to users", async () => {
    const res = await authedFetch(`https://example.com/api/projects/${PROJECT}/members`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      members: { user_id: string; email: string; name: string; role: string }[];
    }>();
    const owner = body.members.find((m) => m.user_id === "usr_dev");
    expect(owner).toMatchObject({
      user_id: "usr_dev",
      email: "aphisak@mohara.co",
      role: "owner",
    });
  });
});

describe("POST /api/projects/:id/invites — allowed_email_domain enforcement (Story 5)", () => {
  // The restriction is shared D1 state; clear it after each test in this block.
  afterEach(async () => {
    await env.DB.prepare("UPDATE projects SET allowed_email_domain = NULL WHERE id = ?")
      .bind(PROJECT)
      .run();
  });

  async function setDomain(domain: string | null) {
    await env.DB.prepare("UPDATE projects SET allowed_email_domain = ? WHERE id = ?")
      .bind(domain, PROJECT)
      .run();
  }

  it("rejects an out-of-domain email with 400 and writes no invite row", async () => {
    await setDomain("mohara.co");
    const res = await createInvite({ email: "outsider@gmail.com", role: "member" });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/allowed domain/i);

    const row = await env.DB.prepare(
      "SELECT id FROM invites WHERE project_id = ? AND email = 'outsider@gmail.com'",
    )
      .bind(PROJECT)
      .first<{ id: string }>();
    expect(row).toBeNull();
  });

  it("allows an in-domain email while the restriction is active", async () => {
    await setDomain("mohara.co");
    const res = await createInvite({ email: "indomain@mohara.co", role: "member" });
    expect(res.status).toBe(201);
    const body = await res.json<{ token: string }>();
    expect(body.token).toBeTruthy();
  });

  it("allows any domain once the restriction is cleared", async () => {
    await setDomain(null);
    const res = await createInvite({ email: "anyone@gmail.com", role: "member" });
    expect(res.status).toBe(201);
  });
});

function fetchPublic(token: string) {
  // Public route — no session cookie needed.
  return import("cloudflare:test").then(({ SELF }) =>
    SELF.fetch(`https://example.com/api/invites/${token}`),
  );
}

describe("GET /api/invites/:token (unauthenticated)", () => {
  it("returns project_name, email, role for a valid pending invite", async () => {
    const created = await createInvite({ email: "valid-lookup@mohara.co", role: "member" });
    const { token } = await created.json<{ token: string }>();

    const res = await fetchPublic(token);
    expect(res.status).toBe(200);
    const body = await res.json<{ project_name: string; email: string; role: string }>();
    expect(body).toMatchObject({
      project_name: "EVO",
      email: "valid-lookup@mohara.co",
      role: "member",
    });
  });

  it("returns 410 for an expired invite", async () => {
    const created = await createInvite({ email: "expired@mohara.co", role: "member" });
    const { token } = await created.json<{ token: string }>();
    // Backdate created_at + expires_at to 8 days ago.
    const eightDaysAgo = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    await env.DB.prepare(
      "UPDATE invites SET created_at = ?, expires_at = ? WHERE token = ?",
    )
      .bind(eightDaysAgo - 1, eightDaysAgo, token)
      .run();

    const res = await fetchPublic(token);
    expect(res.status).toBe(410);
  });

  it("returns 410 for an already-accepted invite", async () => {
    const created = await createInvite({ email: "already-accepted@mohara.co", role: "member" });
    const { token } = await created.json<{ token: string }>();
    await env.DB.prepare("UPDATE invites SET accepted_at = unixepoch() WHERE token = ?")
      .bind(token)
      .run();

    const res = await fetchPublic(token);
    expect(res.status).toBe(410);
  });

  it("returns 410 for an unknown token", async () => {
    const res = await fetchPublic("totally-made-up-token");
    expect(res.status).toBe(410);
  });
});

describe("owner-gating (403 for non-owner members)", () => {
  // Seed a separate member user + membership + session.
  const MEMBER_TOKEN = "member-session";
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at)
       VALUES ('usr_member', 'member@mohara.co', 'Member User', unixepoch())`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO memberships (project_id, user_id, role)
       VALUES (?, 'usr_member', 'member')`,
    )
      .bind(PROJECT)
      .run();
    await seedSession(env, {
      token: MEMBER_TOKEN,
      userId: "usr_member",
      projectId: PROJECT,
      role: "member",
    });
  });

  it("rejects a non-owner POSTing an invite → 403", async () => {
    const res = await createInvite({ email: "nope@mohara.co", role: "member" }, MEMBER_TOKEN);
    expect(res.status).toBe(403);
  });

  it("rejects a non-owner listing invites → 403", async () => {
    const res = await authedFetch(
      `https://example.com/api/projects/${PROJECT}/invites`,
      {},
      MEMBER_TOKEN,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a non-owner listing members → 403", async () => {
    const res = await authedFetch(
      `https://example.com/api/projects/${PROJECT}/members`,
      {},
      MEMBER_TOKEN,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a non-owner revoking an invite → 403", async () => {
    const res = await authedFetch(
      `https://example.com/api/projects/${PROJECT}/invites/inv_whatever`,
      { method: "DELETE" },
      MEMBER_TOKEN,
    );
    expect(res.status).toBe(403);
  });
});
