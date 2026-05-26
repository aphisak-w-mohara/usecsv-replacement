import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/importers/:importer_id/columns", () => {
  it("returns the column list for a known importer scoped to the dev session's project", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_tenants/columns");
    expect(res.status).toBe(200);
    const body = await res.json();
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
    const body = await res.json();
    const names = body.columns.map((c: { name: string }) => c.name);
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
