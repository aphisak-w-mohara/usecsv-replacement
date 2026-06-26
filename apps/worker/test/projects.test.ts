import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { authedFetch, seedSession } from "./helpers/auth.js";

const PROJECT = "proj_evo";

beforeAll(() => seedSession(env));

// allowed_email_domain is shared D1 state (isolatedStorage: false). Reset it
// after every test so ordering can't leak a restriction into another test/file.
afterEach(async () => {
  await env.DB.prepare("UPDATE projects SET allowed_email_domain = NULL WHERE id = ?")
    .bind(PROJECT)
    .run();
});

function patchDomain(value: string | null, token?: string) {
  return authedFetch(
    `https://example.com/api/projects/${PROJECT}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowed_email_domain: value }),
    },
    token,
  );
}

describe("PATCH /api/projects/:id (allowed_email_domain)", () => {
  it("sets a valid domain, lowercased, and returns it", async () => {
    const res = await patchDomain("Mohara.CO");
    expect(res.status).toBe(200);
    const body = await res.json<{ allowed_email_domain: string | null }>();
    expect(body.allowed_email_domain).toBe("mohara.co");

    const row = await env.DB.prepare(
      "SELECT allowed_email_domain FROM projects WHERE id = ?",
    )
      .bind(PROJECT)
      .first<{ allowed_email_domain: string | null }>();
    expect(row?.allowed_email_domain).toBe("mohara.co");
  });

  it("clears the domain when an empty string is sent", async () => {
    await patchDomain("mohara.co");
    const res = await patchDomain("");
    expect(res.status).toBe(200);
    const body = await res.json<{ allowed_email_domain: string | null }>();
    expect(body.allowed_email_domain).toBeNull();

    const row = await env.DB.prepare(
      "SELECT allowed_email_domain FROM projects WHERE id = ?",
    )
      .bind(PROJECT)
      .first<{ allowed_email_domain: string | null }>();
    expect(row?.allowed_email_domain).toBeNull();
  });

  it("clears the domain when null is sent", async () => {
    await patchDomain("mohara.co");
    const res = await patchDomain(null);
    expect(res.status).toBe(200);
    const body = await res.json<{ allowed_email_domain: string | null }>();
    expect(body.allowed_email_domain).toBeNull();
  });

  it("rejects an invalid domain (no dot) with 400 and leaves the value unchanged", async () => {
    const res = await patchDomain("mohara");
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/valid domain/i);

    const row = await env.DB.prepare(
      "SELECT allowed_email_domain FROM projects WHERE id = ?",
    )
      .bind(PROJECT)
      .first<{ allowed_email_domain: string | null }>();
    expect(row?.allowed_email_domain).toBeNull();
  });

  it("rejects an invalid domain (illegal chars) with 400", async () => {
    const res = await patchDomain("not a domain");
    expect(res.status).toBe(400);
  });

  it("returns 404 (not 403) for a cross-project id (IDOR)", async () => {
    const res = await authedFetch("https://example.com/api/projects/proj_other", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowed_email_domain: "mohara.co" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:id", () => {
  it("returns id, name, allowed_email_domain and mismatched_member_count", async () => {
    await patchDomain("mohara.co");
    const res = await authedFetch(`https://example.com/api/projects/${PROJECT}`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      id: string;
      name: string;
      allowed_email_domain: string | null;
      mismatched_member_count: number;
    }>();
    expect(body.id).toBe(PROJECT);
    expect(body.name).toBe("EVO");
    expect(body.allowed_email_domain).toBe("mohara.co");
    // Seed owner aphisak@mohara.co matches → 0 mismatches.
    expect(body.mismatched_member_count).toBe(0);
  });

  it("counts existing members whose domain doesn't match", async () => {
    // A member on a different domain.
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at)
       VALUES ('usr_legacy', 'legacy@otherco.com', 'Legacy', unixepoch())`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO memberships (project_id, user_id, role)
       VALUES (?, 'usr_legacy', 'member')`,
    )
      .bind(PROJECT)
      .run();

    await patchDomain("mohara.co");
    const res = await authedFetch(`https://example.com/api/projects/${PROJECT}`);
    const body = await res.json<{ mismatched_member_count: number }>();
    expect(body.mismatched_member_count).toBeGreaterThanOrEqual(1);

    // Cleanup so other tests' member counts are unaffected.
    await env.DB.prepare("DELETE FROM memberships WHERE user_id = 'usr_legacy'").run();
    await env.DB.prepare("DELETE FROM users WHERE id = 'usr_legacy'").run();
  });

  it("reports 0 mismatches when no domain is set", async () => {
    const res = await authedFetch(`https://example.com/api/projects/${PROJECT}`);
    const body = await res.json<{
      allowed_email_domain: string | null;
      mismatched_member_count: number;
    }>();
    expect(body.allowed_email_domain).toBeNull();
    expect(body.mismatched_member_count).toBe(0);
  });
});

describe("project settings owner-gating", () => {
  const MEMBER_TOKEN = "projects-member";
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, email, name, created_at)
       VALUES ('usr_proj_member', 'projmember@mohara.co', 'Proj Member', unixepoch())`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO memberships (project_id, user_id, role)
       VALUES (?, 'usr_proj_member', 'member')`,
    )
      .bind(PROJECT)
      .run();
    await seedSession(env, {
      token: MEMBER_TOKEN,
      userId: "usr_proj_member",
      projectId: PROJECT,
      role: "member",
    });
  });

  it("rejects a non-owner PATCH → 403", async () => {
    const res = await patchDomain("mohara.co", MEMBER_TOKEN);
    expect(res.status).toBe(403);
  });

  it("rejects a non-owner GET → 403", async () => {
    const res = await authedFetch(
      `https://example.com/api/projects/${PROJECT}`,
      {},
      MEMBER_TOKEN,
    );
    expect(res.status).toBe(403);
  });
});
