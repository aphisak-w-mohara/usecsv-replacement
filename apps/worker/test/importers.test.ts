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

describe("GET /api/importers/:importer_id", () => {
  it("returns the importer row with column + env counts for a known id in the active project", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_tenants");
    expect(res.status).toBe(200);
    const body = await res.json<{
      importer: {
        id: string;
        name: string;
        column_count: number;
        env_count: number;
        archived: boolean;
        updated_at: number;
      };
    }>();
    expect(body.importer).toMatchObject({
      id: "imp_tenants",
      name: "Tenants",
      column_count: 3,
      env_count: 1,
      archived: false,
    });
    expect(typeof body.importer.updated_at).toBe("number");
  });

  it("returns 404 for an unknown importer id", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_get', 'proj_foreign', 'Foreign Importer Get', unixepoch(), unixepoch())`,
      ),
    ]);

    const res = await SELF.fetch("https://example.com/api/importers/imp_foreign_get");
    expect(res.status).toBe(404);
  });

  it("includes archived importers in the single-row fetch (so the detail page can render them)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, archived_at, created_at, updated_at)
       VALUES ('imp_arch_get', 'proj_evo', 'Archived One', unixepoch(), unixepoch(), unixepoch())`,
    ).run();

    const res = await SELF.fetch("https://example.com/api/importers/imp_arch_get");
    expect(res.status).toBe(200);
    const body = await res.json<{ importer: { archived: boolean } }>();
    expect(body.importer.archived).toBe(true);
  });
});

describe("PATCH /api/importers/:importer_id", () => {
  async function patch(id: string, body: { name?: string; archived?: boolean }) {
    return SELF.fetch(`https://example.com/api/importers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("renames the importer, bumps updated_at, returns the updated row", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_rename_target', 'proj_evo', 'Rename Me', unixepoch() - 5, unixepoch() - 5)`,
    ).run();
    const before = await env.DB.prepare(
      "SELECT updated_at FROM importers WHERE id = 'imp_rename_target'",
    ).first<{ updated_at: number }>();
    expect(before?.updated_at).toBeDefined();

    // Force a clock-tick so updated_at can change.
    await new Promise((r) => setTimeout(r, 1100));

    const res = await patch("imp_rename_target", { name: "Rename Me v2" });
    expect(res.status).toBe(200);
    const body = await res.json<{ importer: { name: string; updated_at: number } }>();
    expect(body.importer.name).toBe("Rename Me v2");
    expect(body.importer.updated_at).toBeGreaterThan(before!.updated_at);
  });

  it("trims the new name and rejects empty/whitespace with 400", async () => {
    const res = await patch("imp_tenants", { name: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a colliding name (case-insensitive) within the project with 409", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_other_pat', 'proj_evo', 'Other Importer Pat', unixepoch(), unixepoch())`,
    ).run();

    const res = await patch("imp_other_pat", { name: "tenants" });
    expect(res.status).toBe(409);
  });

  it("archives the importer and clears archive on toggle", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_arch_target', 'proj_evo', 'Archive Me', unixepoch(), unixepoch())`,
    ).run();

    const archRes = await patch("imp_arch_target", { archived: true });
    expect(archRes.status).toBe(200);
    const archBody = await archRes.json<{ importer: { archived: boolean } }>();
    expect(archBody.importer.archived).toBe(true);

    const dbRow = await env.DB.prepare(
      "SELECT archived_at FROM importers WHERE id = 'imp_arch_target'",
    ).first<{ archived_at: number | null }>();
    expect(dbRow?.archived_at).not.toBeNull();

    const unRes = await patch("imp_arch_target", { archived: false });
    expect(unRes.status).toBe(200);
    const unBody = await unRes.json<{ importer: { archived: boolean } }>();
    expect(unBody.importer.archived).toBe(false);

    const dbRow2 = await env.DB.prepare(
      "SELECT archived_at FROM importers WHERE id = 'imp_arch_target'",
    ).first<{ archived_at: number | null }>();
    expect(dbRow2?.archived_at).toBeNull();
  });

  it("renames and archives in one call (both fields together)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_combo', 'proj_evo', 'Combo Original', unixepoch(), unixepoch())`,
    ).run();

    const res = await patch("imp_combo", { name: "Combo Renamed", archived: true });
    expect(res.status).toBe(200);
    const body = await res.json<{ importer: { name: string; archived: boolean } }>();
    expect(body.importer.name).toBe("Combo Renamed");
    expect(body.importer.archived).toBe(true);
  });

  it("empty body is a no-op 200 (no fields supplied)", async () => {
    const res = await patch("imp_tenants", {});
    expect(res.status).toBe(200);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_pat', 'proj_foreign', 'Foreign Importer Pat', unixepoch(), unixepoch())`,
      ),
    ]);

    const res = await patch("imp_foreign_pat", { name: "Renamed Foreign" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/importers/:importer_id/columns", () => {
  async function create(importerId: string, body: unknown) {
    return SELF.fetch(`https://example.com/api/importers/${importerId}/columns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates a column with position = max+1 and returns it", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_col_target', 'proj_evo', 'Col Target', unixepoch(), unixepoch())`,
    ).run();

    const res = await create("imp_col_target", {
      name: "phone_number",
      display_name: "Phone number",
      validation_type: "phone",
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ column: { id: string; name: string; validation_type: string } }>();
    expect(body.column).toMatchObject({
      name: "phone_number",
      display_name: "Phone number",
      validation_type: "phone",
      must_be_matched: true,
      value_cannot_be_blank: true,
    });
    expect(body.column.id).toMatch(/^col_/);

    const pos = await env.DB.prepare(
      "SELECT position FROM importer_columns WHERE id = ?",
    )
      .bind(body.column.id)
      .first<{ position: number }>();
    expect(pos?.position).toBe(1);

    const second = await create("imp_col_target", {
      name: "second_col",
      display_name: "Second",
    });
    expect(second.status).toBe(201);
    const secondBody = await second.json<{ column: { id: string } }>();
    const pos2 = await env.DB.prepare(
      "SELECT position FROM importer_columns WHERE id = ?",
    )
      .bind(secondBody.column.id)
      .first<{ position: number }>();
    expect(pos2?.position).toBe(2);
  });

  it("rejects an invalid machine name with 400", async () => {
    const res = await create("imp_tenants", {
      name: "Bad Name",
      display_name: "Bad",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a name beginning with a digit with 400", async () => {
    const res = await create("imp_tenants", {
      name: "1abc",
      display_name: "Bad",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate column name within the importer with 409", async () => {
    const res = await create("imp_tenants", {
      name: "first_name",
      display_name: "Dup",
    });
    expect(res.status).toBe(409);
  });

  it("rejects an invalid validation_type with 400", async () => {
    const res = await create("imp_tenants", {
      name: "weird_field",
      display_name: "Weird",
      validation_type: "fancy_type",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_col', 'proj_foreign', 'Foreign Importer Col', unixepoch(), unixepoch())`,
      ),
    ]);

    const res = await create("imp_foreign_col", {
      name: "first_name",
      display_name: "First",
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/importers/:importer_id/columns/:column_id", () => {
  async function patchCol(importerId: string, columnId: string, body: unknown) {
    return SELF.fetch(
      `https://example.com/api/importers/${importerId}/columns/${columnId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  it("updates a single column field and leaves others untouched", async () => {
    const { env } = await import("cloudflare:test");
    const colId = "col_patch_target";
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importer_columns
         (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
       VALUES (?, 'imp_tenants', 99, 'patch_me', 'Patch Me', 'string', 1, 1)`,
    )
      .bind(colId)
      .run();

    const res = await patchCol("imp_tenants", colId, { display_name: "Patched Name" });
    expect(res.status).toBe(200);
    const body = await res.json<{ column: { display_name: string; name: string } }>();
    expect(body.column.display_name).toBe("Patched Name");
    expect(body.column.name).toBe("patch_me");
  });

  it("rejects renaming to an existing column name within the importer with 409", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importer_columns
         (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
       VALUES ('col_rename_src', 'imp_tenants', 98, 'rename_me', 'Rename', 'string', 1, 1)`,
    ).run();

    const res = await patchCol("imp_tenants", "col_rename_src", { name: "first_name" });
    expect(res.status).toBe(409);
  });

  it("returns 404 when the column belongs to a different importer", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_col_owner_other', 'proj_evo', 'Other Importer', unixepoch(), unixepoch())`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importer_columns
         (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
       VALUES ('col_in_other_imp', 'imp_col_owner_other', 1, 'other_col', 'Other', 'string', 1, 1)`,
    ).run();

    const res = await patchCol("imp_tenants", "col_in_other_imp", { display_name: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_col_pat', 'proj_foreign', 'FI ColPat', unixepoch(), unixepoch())`,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importer_columns
           (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
         VALUES ('col_in_foreign_imp', 'imp_foreign_col_pat', 1, 'first_name', 'F', 'string', 1, 1)`,
      ),
    ]);

    const res = await patchCol("imp_foreign_col_pat", "col_in_foreign_imp", { display_name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/importers/:importer_id/columns/:column_id", () => {
  it("removes the column and returns 204", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importer_columns
         (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
       VALUES ('col_to_delete', 'imp_tenants', 97, 'goodbye', 'Goodbye', 'string', 1, 1)`,
    ).run();

    const res = await SELF.fetch(
      "https://example.com/api/importers/imp_tenants/columns/col_to_delete",
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);

    const row = await env.DB.prepare(
      "SELECT id FROM importer_columns WHERE id = 'col_to_delete'",
    ).first();
    expect(row).toBeNull();
  });

  it("returns 404 when the column belongs to a different importer", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_other_del', 'proj_evo', 'Other Del', unixepoch(), unixepoch())`,
    ).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importer_columns
         (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
       VALUES ('col_other_imp_del', 'imp_other_del', 1, 'other_col_del', 'OD', 'string', 1, 1)`,
    ).run();

    const res = await SELF.fetch(
      "https://example.com/api/importers/imp_tenants/columns/col_other_imp_del",
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_del', 'proj_foreign', 'FI Del', unixepoch(), unixepoch())`,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importer_columns
           (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
         VALUES ('col_foreign_del', 'imp_foreign_del', 1, 'foreign_col', 'FC', 'string', 1, 1)`,
      ),
    ]);

    const res = await SELF.fetch(
      "https://example.com/api/importers/imp_foreign_del/columns/col_foreign_del",
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/importers/:importer_id/columns/order", () => {
  async function setupImporterWithColumns(importerId: string, columnSpecs: { id: string; name: string }[]) {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
       VALUES (?, 'proj_evo', ?, unixepoch(), unixepoch())`,
    )
      .bind(importerId, `Reorder ${importerId}`)
      .run();
    for (let i = 0; i < columnSpecs.length; i++) {
      const s = columnSpecs[i]!;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO importer_columns
           (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
         VALUES (?, ?, ?, ?, ?, 'string', 1, 1)`,
      )
        .bind(s.id, importerId, i + 1, s.name, s.name)
        .run();
    }
  }

  async function putOrder(importerId: string, ordered_ids: string[]) {
    return SELF.fetch(
      `https://example.com/api/importers/${importerId}/columns/order`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ordered_ids }),
      },
    );
  }

  it("reorders the columns and returns them in the new order", async () => {
    const { env } = await import("cloudflare:test");
    await setupImporterWithColumns("imp_reorder_ok", [
      { id: "col_ro_a", name: "alpha" },
      { id: "col_ro_b", name: "beta" },
      { id: "col_ro_c", name: "gamma" },
    ]);

    const res = await putOrder("imp_reorder_ok", ["col_ro_c", "col_ro_a", "col_ro_b"]);
    expect(res.status).toBe(200);
    const body = await res.json<{ columns: { id: string; position: number }[] }>();
    expect(body.columns.map((c) => c.id)).toEqual([
      "col_ro_c",
      "col_ro_a",
      "col_ro_b",
    ]);
    expect(body.columns.map((c) => c.position)).toEqual([1, 2, 3]);

    const dbRows = await env.DB.prepare(
      "SELECT id, position FROM importer_columns WHERE importer_id = 'imp_reorder_ok' ORDER BY position ASC",
    ).all<{ id: string; position: number }>();
    expect(dbRows.results.map((r) => r.id)).toEqual([
      "col_ro_c",
      "col_ro_a",
      "col_ro_b",
    ]);
  });

  it("rejects a partial id list (missing an existing column) with 400", async () => {
    await setupImporterWithColumns("imp_reorder_partial", [
      { id: "col_rp_a", name: "alpha" },
      { id: "col_rp_b", name: "beta" },
    ]);
    const res = await putOrder("imp_reorder_partial", ["col_rp_a"]);
    expect(res.status).toBe(400);
  });

  it("rejects an extra id with 400", async () => {
    await setupImporterWithColumns("imp_reorder_extra", [
      { id: "col_re_a", name: "alpha" },
      { id: "col_re_b", name: "beta" },
    ]);
    const res = await putOrder("imp_reorder_extra", ["col_re_a", "col_re_b", "col_re_c"]);
    expect(res.status).toBe(400);
  });

  it("rejects duplicate ids with 400", async () => {
    await setupImporterWithColumns("imp_reorder_dup", [
      { id: "col_rd_a", name: "alpha" },
      { id: "col_rd_b", name: "beta" },
    ]);
    const res = await putOrder("imp_reorder_dup", ["col_rd_a", "col_rd_a"]);
    expect(res.status).toBe(400);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_ord', 'proj_foreign', 'FI Ord', unixepoch(), unixepoch())`,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO importer_columns
           (id, importer_id, position, name, display_name, validation_type, must_be_matched, value_cannot_be_blank)
         VALUES ('col_fo_a', 'imp_foreign_ord', 1, 'a', 'A', 'string', 1, 1)`,
      ),
    ]);

    const res = await putOrder("imp_foreign_ord", ["col_fo_a"]);
    expect(res.status).toBe(404);
  });
});

