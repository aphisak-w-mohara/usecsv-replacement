import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { OWNER_EMAIL, authedFetch } from "./helpers/auth.js";

const PROJECT = "proj_evo";
const MEMBER_EMAIL = "envtest-member@mohara.co";
// Suite-unique env names/slugs. Other suites (importers/grants) already create
// `production`/`staging`/`uat` envs for proj_evo in the shared DB, so this suite
// must NOT reuse those slugs — both to stay deterministic regardless of file
// order and so cleanup never touches another suite's child-referenced rows.
const SLUGS = ["sandbox", "sandbox-eu", "sbx-eu", "sbx-2"];

function createEnv(
  body: unknown,
  email: string = OWNER_EMAIL,
  project: string = PROJECT,
): Promise<Response> {
  return authedFetch(
    `https://example.com/api/projects/${project}/environments`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    email,
  );
}

// Shared D1 (isolatedStorage: false): delete ONLY the envs this suite creates,
// by their known slugs. A blanket `is_default = 0` delete would hit other
// suites' envs (which have importer_environment children) and FK-fail.
afterEach(async () => {
  await env.DB.prepare(
    `DELETE FROM environments WHERE project_id = ? AND slug IN (${SLUGS.map(() => "?").join(", ")})`,
  )
    .bind(PROJECT, ...SLUGS)
    .run();
});

describe("POST /api/projects/:id/environments — create (owner-only, unique per project)", () => {
  it("owner creates an environment; slug derived from the name; is_default false", async () => {
    const res = await createEnv({ name: "Sandbox" });
    expect(res.status).toBe(201);
    const { environment } = await res.json<{
      environment: { id: string; slug: string; name: string; is_default: boolean };
    }>();
    expect(environment).toMatchObject({ slug: "sandbox", name: "Sandbox", is_default: false });
    expect(environment.id).toMatch(/^env_/);

    const row = await env.DB.prepare("SELECT project_id, is_default FROM environments WHERE id = ?")
      .bind(environment.id)
      .first<{ project_id: string; is_default: number }>();
    expect(row?.project_id).toBe(PROJECT);
    expect(row?.is_default).toBe(0);
  });

  it("accepts an explicit slug", async () => {
    const res = await createEnv({ name: "Sandbox EU", slug: "sbx-eu" });
    expect(res.status).toBe(201);
    expect((await res.json<{ environment: { slug: string } }>()).environment.slug).toBe("sbx-eu");
  });

  it("rejects a duplicate slug with 409", async () => {
    expect((await createEnv({ name: "Sandbox" })).status).toBe(201);
    const dup = await createEnv({ name: "Sandbox again", slug: "sandbox" });
    expect(dup.status).toBe(409);
    expect((await dup.json<{ error: string }>()).error).toMatch(/slug/i);
  });

  it("rejects a duplicate name case-insensitively with 409 (even with a distinct slug)", async () => {
    expect((await createEnv({ name: "Sandbox" })).status).toBe(201);
    const dup = await createEnv({ name: "sandbox", slug: "sbx-2" });
    expect(dup.status).toBe(409);
    expect((await dup.json<{ error: string }>()).error).toMatch(/name/i);
  });

  it("collides with the seeded default environment (slug 'staging') → 409", async () => {
    const dup = await createEnv({ name: "Staging again", slug: "staging" });
    expect(dup.status).toBe(409);
  });

  it("rejects an invalid slug format with 400", async () => {
    const res = await createEnv({ name: "Sandbox", slug: "Bad Slug!" });
    expect(res.status).toBe(400);
  });

  it("rejects a name that yields an empty slug with 400", async () => {
    const res = await createEnv({ name: "!!!" });
    expect(res.status).toBe(400);
  });

  it("forbids a non-owner member with 403", async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, name, created_at) VALUES ('usr_envtest', ?, 'Env Test Member', unixepoch())",
    )
      .bind(MEMBER_EMAIL)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO memberships (project_id, user_id, role) VALUES (?, 'usr_envtest', 'member')",
    )
      .bind(PROJECT)
      .run();

    const res = await createEnv({ name: "Sandbox" }, MEMBER_EMAIL);
    expect(res.status).toBe(403);
  });

  it("404s for a different project id (IDOR — never leak existence)", async () => {
    const res = await createEnv({ name: "Sandbox" }, OWNER_EMAIL, "proj_foreign");
    expect(res.status).toBe(404);
  });
});
