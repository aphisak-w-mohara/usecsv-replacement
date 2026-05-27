import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/importers", () => {
  it("lists non-archived importers for the dev session's project with counts", async () => {
    const res = await SELF.fetch("https://example.com/api/importers");
    expect(res.status).toBe(200);
    const body = await res.json<{ importers: { id: string }[] }>();
    const tenants = body.importers.find((i) => i.id === "imp_tenants");
    expect(tenants).toMatchObject({
      id: "imp_tenants",
      name: "Tenants",
      column_count: 3,
      env_count: 1,
      archived: false,
      updated_at: expect.any(Number),
    });
  });

  it("excludes archived importers by default and includes them with ?include_archived=true", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, archived_at, created_at, updated_at)
       VALUES ('imp_archived', 'proj_evo', 'Old Importer', unixepoch(), unixepoch(), unixepoch())`,
    ).run();

    const without = await (
      await SELF.fetch("https://example.com/api/importers")
    ).json<{ importers: { id: string }[] }>();
    expect(without.importers.map((i) => i.id)).not.toContain("imp_archived");

    const withArchived = await (
      await SELF.fetch("https://example.com/api/importers?include_archived=true")
    ).json<{ importers: { id: string; archived: boolean }[] }>();
    const archived = withArchived.importers.find((i) => i.id === "imp_archived");
    expect(archived).toMatchObject({ id: "imp_archived", archived: true });
  });

  it("never lists importers from a different project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO projects (id, slug, name, created_at)
       VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_foreign', 'proj_foreign', 'Foreign Importer', unixepoch(), unixepoch())`,
    ).run();

    const body = await (
      await SELF.fetch("https://example.com/api/importers?include_archived=true")
    ).json<{ importers: { id: string }[] }>();
    expect(body.importers.map((i) => i.id)).not.toContain("imp_foreign");
  });
});

describe("POST /api/importers", () => {
  async function create(body: unknown) {
    return SELF.fetch("https://example.com/api/importers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates an importer scoped to the session project and returns it", async () => {
    const res = await create({ name: "Properties" });
    expect(res.status).toBe(201);
    const body = await res.json<{ importer: { id: string } }>();
    expect(body.importer).toMatchObject({
      name: "Properties",
      column_count: 0,
      env_count: 0,
      archived: false,
    });
    expect(body.importer.id).toMatch(/^imp_/);

    const { env } = await import("cloudflare:test");
    const row = await env.DB.prepare(
      "SELECT project_id FROM importers WHERE id = ?",
    )
      .bind(body.importer.id)
      .first<{ project_id: string }>();
    expect(row?.project_id).toBe("proj_evo");
  });

  it("trims the name and rejects an empty/whitespace name with 400", async () => {
    const res = await create({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate name (case-insensitive) within the project with 409", async () => {
    const res = await create({ name: "tenants" });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toBe("An importer with this name already exists");
  });

  it("double-creating the same name yields exactly one row and a 409", async () => {
    const first = await create({ name: "Vehicles" });
    expect(first.status).toBe(201);

    const second = await create({ name: "Vehicles" });
    expect(second.status).toBe(409);
    const body = await second.json<{ error: string }>();
    expect(body.error).toBe("An importer with this name already exists");

    const { env } = await import("cloudflare:test");
    const rows = await env.DB.prepare(
      "SELECT id FROM importers WHERE project_id = 'proj_evo' AND name = 'Vehicles'",
    ).all();
    expect(rows.results).toHaveLength(1);
  });

  it("enforces (project, name) uniqueness at the DB level, case-insensitively", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_dup_a', 'proj_evo', 'Vendors', unixepoch(), unixepoch())`,
    ).run();

    await expect(
      env.DB.prepare(
        `INSERT INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_dup_b', 'proj_evo', 'vendors', unixepoch(), unixepoch())`,
      ).run(),
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });

  it("ignores any project_id in the body and uses the session project", async () => {
    const res = await create({ name: "Forged Project Importer", project_id: "proj_foreign" });
    expect(res.status).toBe(201);
    const body = await res.json<{ importer: { id: string } }>();

    const { env } = await import("cloudflare:test");
    const row = await env.DB.prepare(
      "SELECT project_id FROM importers WHERE id = ?",
    )
      .bind(body.importer.id)
      .first<{ project_id: string }>();
    expect(row?.project_id).toBe("proj_evo");
  });
});

describe("GET /api/importers/:importer_id/columns", () => {
  it("returns the column list for a known importer scoped to the dev session's project", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_tenants/columns");
    expect(res.status).toBe(200);
    const body = await res.json<{ importer_id: string; columns: { name: string }[] }>();
    expect(body).toMatchObject({
      importer_id: "imp_tenants",
      columns: expect.any(Array),
    });
    expect(body.columns).toHaveLength(3);
    expect(body.columns[0]).toMatchObject({
      name: "first_name",
      display_name: "First name",
      must_be_matched: true,
      validation_type: "string",
    });
    expect(body.columns[1]).toMatchObject({ name: "last_name" });
    expect(body.columns[2]).toMatchObject({
      name: "email",
      validation_type: "email",
    });
  });

  it("returns columns in position order, not insertion order", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_tenants/columns");
    expect(res.status).toBe(200);
    const body = await res.json<{ columns: { name: string }[] }>();
    const names = body.columns.map((c) => c.name);
    expect(names).toEqual(["first_name", "last_name", "email"]);
  });

  it("returns 404 for an unknown importer id", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_nonexistent/columns");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an importer that exists but belongs to a different project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO projects (id, slug, name, created_at) VALUES ('proj_other', 'other', 'Other Co', unixepoch())",
      ),
      env.DB.prepare(
        "INSERT INTO importers (id, project_id, name, created_at, updated_at) VALUES ('imp_other', 'proj_other', 'Other', unixepoch(), unixepoch())",
      ),
      env.DB.prepare(
        `INSERT INTO importer_columns (id, importer_id, position, name, display_name, description, example, must_be_matched, value_cannot_be_blank, validation_type, validation_format, custom_error_message)
         VALUES ('col_other_x', 'imp_other', 1, 'x', 'X', NULL, NULL, 1, 1, 'string', NULL, NULL)`,
      ),
    ]);

    const res = await SELF.fetch("https://example.com/api/importers/imp_other/columns");
    expect(res.status).toBe(404);
  });
});
