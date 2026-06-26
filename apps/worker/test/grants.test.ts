import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedFetch, seedSession } from "./helpers/auth.js";

const PROJECT = "proj_evo";
const STAGING = "env_evo_staging"; // seeded default env
const PRODUCTION = "env_evo_prod"; // added below — a second env to grant/gate

const OWNER_TOKEN = "grants-owner";
const MEMBER_TOKEN = "grants-member"; // session pinned to STAGING
const MEMBER_PROD_TOKEN = "grants-member-prod"; // same member, session on PRODUCTION

const MEMBER_USER = "usr_grant_member";

beforeAll(async () => {
  // A second environment in the project so grants have something to toggle.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO environments (id, project_id, slug, name, is_default, created_at)
     VALUES (?, ?, 'production', 'Production', 0, unixepoch())`,
  )
    .bind(PRODUCTION, PROJECT)
    .run();

  // A member user + membership (no env grants yet).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, name, created_at)
     VALUES (?, 'grantee@mohara.co', 'Grantee', unixepoch())`,
  )
    .bind(MEMBER_USER)
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO memberships (project_id, user_id, role)
     VALUES (?, ?, 'member')`,
  )
    .bind(PROJECT, MEMBER_USER)
    .run();

  // Sessions: owner, member-on-staging, member-on-production.
  await seedSession(env, { token: OWNER_TOKEN }); // defaults to usr_dev owner
  await seedSession(env, {
    token: MEMBER_TOKEN,
    userId: MEMBER_USER,
    projectId: PROJECT,
    environmentId: STAGING,
    role: "member",
  });
  await seedSession(env, {
    token: MEMBER_PROD_TOKEN,
    userId: MEMBER_USER,
    projectId: PROJECT,
    environmentId: PRODUCTION,
    role: "member",
  });
});

function grantUrl(envId: string, userId: string) {
  return `https://example.com/api/projects/${PROJECT}/environments/${envId}/grants/${userId}`;
}

const MATRIX_URL = `https://example.com/api/projects/${PROJECT}/grants`;

async function meEnvIds(token: string): Promise<string[]> {
  const res = await authedFetch("https://example.com/api/me", {}, token);
  expect(res.status).toBe(200);
  const body = await res.json<{ accessible_environments: { id: string }[] }>();
  return body.accessible_environments.map((e) => e.id);
}

describe("PUT/DELETE grants (owner)", () => {
  it("owner grants a member an env → row exists + member's /api/me lists it", async () => {
    // Before: member has no grants, so no accessible envs.
    expect(await meEnvIds(MEMBER_TOKEN)).toEqual([]);

    const put = await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "PUT" }, OWNER_TOKEN);
    expect(put.status).toBe(204);

    const row = await env.DB.prepare(
      `SELECT granted_by FROM environment_grants
       WHERE project_id = ? AND user_id = ? AND environment_id = ?`,
    )
      .bind(PROJECT, MEMBER_USER, STAGING)
      .first<{ granted_by: string }>();
    expect(row?.granted_by).toBe("usr_dev");

    expect(await meEnvIds(MEMBER_TOKEN)).toEqual([STAGING]);
  });

  it("granting the same env again is idempotent (still 204, one row)", async () => {
    const put = await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "PUT" }, OWNER_TOKEN);
    expect(put.status).toBe(204);
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM environment_grants
       WHERE project_id = ? AND user_id = ? AND environment_id = ?`,
    )
      .bind(PROJECT, MEMBER_USER, STAGING)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("owner revokes → grant gone + /api/me no longer lists it", async () => {
    const del = await authedFetch(
      grantUrl(STAGING, MEMBER_USER),
      { method: "DELETE" },
      OWNER_TOKEN,
    );
    expect(del.status).toBe(204);

    const row = await env.DB.prepare(
      `SELECT 1 FROM environment_grants
       WHERE project_id = ? AND user_id = ? AND environment_id = ?`,
    )
      .bind(PROJECT, MEMBER_USER, STAGING)
      .first();
    expect(row).toBeNull();

    expect(await meEnvIds(MEMBER_TOKEN)).toEqual([]);
  });

  it("returns 400 when granting an env to an owner", async () => {
    const put = await authedFetch(grantUrl(STAGING, "usr_dev"), { method: "PUT" }, OWNER_TOKEN);
    expect(put.status).toBe(400);
    const body = await put.json<{ error: string }>();
    expect(body.error).toMatch(/owners always have access/i);
  });

  it("returns 404 when the target user isn't a member of the project", async () => {
    const put = await authedFetch(grantUrl(STAGING, "usr_nobody"), { method: "PUT" }, OWNER_TOKEN);
    expect(put.status).toBe(404);
  });

  it("returns 404 when the environment isn't in the project", async () => {
    const put = await authedFetch(
      grantUrl("env_not_in_project", MEMBER_USER),
      { method: "PUT" },
      OWNER_TOKEN,
    );
    expect(put.status).toBe(404);
  });

  it("returns 404 (not 403) for a cross-project id (IDOR)", async () => {
    const res = await authedFetch(
      `https://example.com/api/projects/proj_other/environments/${STAGING}/grants/${MEMBER_USER}`,
      { method: "PUT" },
      OWNER_TOKEN,
    );
    expect(res.status).toBe(404);
  });

  it("rejects a non-owner toggling a grant → 403", async () => {
    const put = await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "PUT" }, MEMBER_TOKEN);
    expect(put.status).toBe(403);
  });
});

describe("GET /api/projects/:id/grants matrix", () => {
  it("returns environments + per-member granted env ids; owners list all", async () => {
    // Grant the member staging so the matrix has a checked cell to assert.
    await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "PUT" }, OWNER_TOKEN);

    const res = await authedFetch(MATRIX_URL, {}, OWNER_TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json<{
      environments: { id: string; slug: string; name: string }[];
      rows: { user_id: string; email: string; role: string; granted_env_ids: string[] }[];
    }>();

    const envIds = body.environments.map((e) => e.id);
    expect(envIds).toContain(STAGING);
    expect(envIds).toContain(PRODUCTION);

    const ownerRow = body.rows.find((r) => r.user_id === "usr_dev");
    // Owner is implicitly granted every env in the project.
    expect(ownerRow?.role).toBe("owner");
    expect(ownerRow?.granted_env_ids).toEqual(expect.arrayContaining([STAGING, PRODUCTION]));

    const memberRow = body.rows.find((r) => r.user_id === MEMBER_USER);
    expect(memberRow?.role).toBe("member");
    expect(memberRow?.granted_env_ids).toEqual([STAGING]);

    // Clean up so the withEnvironment block below starts from no grants.
    await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "DELETE" }, OWNER_TOKEN);
  });

  it("rejects a non-owner reading the matrix → 403", async () => {
    const res = await authedFetch(MATRIX_URL, {}, MEMBER_TOKEN);
    expect(res.status).toBe(403);
  });
});

describe("withEnvironment gate on env-scoped routes", () => {
  it("member without a grant hitting GET /api/importers (session env = staging) → 404", async () => {
    const res = await authedFetch("https://example.com/api/importers", {}, MEMBER_TOKEN);
    expect(res.status).toBe(404);
  });

  it("member WITH a grant for the session env → 200", async () => {
    await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "PUT" }, OWNER_TOKEN);
    const res = await authedFetch("https://example.com/api/importers", {}, MEMBER_TOKEN);
    expect(res.status).toBe(200);
    await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "DELETE" }, OWNER_TOKEN);
  });

  it("member with a staging grant but session pinned to production → 404", async () => {
    // Grant staging only; the prod-pinned session must still be blocked.
    await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "PUT" }, OWNER_TOKEN);
    const res = await authedFetch("https://example.com/api/importers", {}, MEMBER_PROD_TOKEN);
    expect(res.status).toBe(404);
    await authedFetch(grantUrl(STAGING, MEMBER_USER), { method: "DELETE" }, OWNER_TOKEN);
  });

  it("owner bypasses the env gate without any grant rows → 200", async () => {
    const res = await authedFetch("https://example.com/api/importers", {}, OWNER_TOKEN);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/me/environment switch", () => {
  it("member can switch to a granted env; the session env updates", async () => {
    await authedFetch(grantUrl(PRODUCTION, MEMBER_USER), { method: "PUT" }, OWNER_TOKEN);

    const res = await authedFetch(
      "https://example.com/api/me/environment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment_id: PRODUCTION }),
      },
      MEMBER_PROD_TOKEN,
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ environment: { id: string } }>();
    expect(body.environment.id).toBe(PRODUCTION);

    const raw = await env.SESSIONS.get(`session:${MEMBER_PROD_TOKEN}`);
    const row = JSON.parse(raw!) as { environment_id: string };
    expect(row.environment_id).toBe(PRODUCTION);

    await authedFetch(grantUrl(PRODUCTION, MEMBER_USER), { method: "DELETE" }, OWNER_TOKEN);
  });

  it("switching to a non-accessible env → 404 (IDOR)", async () => {
    const res = await authedFetch(
      "https://example.com/api/me/environment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment_id: PRODUCTION }),
      },
      MEMBER_TOKEN, // member has no grant for production
    );
    expect(res.status).toBe(404);
  });

  it("owner can switch to any env in the project", async () => {
    const res = await authedFetch(
      "https://example.com/api/me/environment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment_id: PRODUCTION }),
      },
      OWNER_TOKEN,
    );
    expect(res.status).toBe(200);
    // Restore the owner session env so other test files seeing this shared token
    // (none today, but be a good citizen) aren't surprised.
    await authedFetch(
      "https://example.com/api/me/environment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ environment_id: STAGING }),
      },
      OWNER_TOKEN,
    );
  });
});
