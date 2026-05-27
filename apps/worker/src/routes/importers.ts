import { Hono } from "hono";
import type { Env, Variables } from "../env.js";

type ImporterListRow = {
  id: string;
  name: string;
  archived_at: number | null;
  updated_at: number;
  column_count: number;
  env_count: number;
};

type ImporterColumnRow = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: number;
  value_cannot_be_blank: number;
  validation_type: string;
  validation_format: string | null;
};

export const importersRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/", async (c) => {
    const session = c.get("session");
    const includeArchived = c.req.query("include_archived") === "true";

    try {
      const sql = `
        SELECT i.id, i.name, i.archived_at, i.updated_at,
               (SELECT COUNT(*) FROM importer_columns ic WHERE ic.importer_id = i.id) AS column_count,
               (SELECT COUNT(*) FROM importer_environments ie WHERE ie.importer_id = i.id) AS env_count
        FROM importers i
        WHERE i.project_id = ?
        ${includeArchived ? "" : "AND i.archived_at IS NULL"}
        ORDER BY i.updated_at DESC, i.id ASC`;

      const result = await c.env.DB.prepare(sql)
        .bind(session.project_id)
        .all<ImporterListRow>();

      const importers = result.results.map((row) => ({
        id: row.id,
        name: row.name,
        column_count: row.column_count,
        env_count: row.env_count,
        archived: row.archived_at !== null,
        updated_at: row.updated_at,
      }));

      return c.json({ importers });
    } catch (err) {
      console.error("DB error in GET /api/importers:", err);
      return c.json({ error: "Database error listing importers" }, 500);
    }
  })
  .get("/:importer_id/columns", async (c) => {
    const importerId = c.req.param("importer_id");
    const session = c.get("session");

    try {
      // Project-scoped existence check. Cross-project importers return 404
      // (not 403) to avoid leaking existence.
      const importer = await c.env.DB.prepare(
        "SELECT id FROM importers WHERE id = ? AND project_id = ?",
      )
        .bind(importerId, session.project_id)
        .first<{ id: string }>();

      if (!importer) {
        return c.json({ error: "Importer not found" }, 404);
      }

      const result = await c.env.DB.prepare(
        `SELECT id, name, display_name, description, example,
                must_be_matched, value_cannot_be_blank,
                validation_type, validation_format
         FROM importer_columns
         WHERE importer_id = ?
         ORDER BY position ASC`,
      )
        .bind(importerId)
        .all<ImporterColumnRow>();

      const columns = result.results.map((row) => ({
        id: row.id,
        name: row.name,
        display_name: row.display_name,
        description: row.description,
        example: row.example,
        must_be_matched: Boolean(row.must_be_matched),
        value_cannot_be_blank: Boolean(row.value_cannot_be_blank),
        validation_type: row.validation_type,
        validation_format: row.validation_format,
      }));

      return c.json({
        importer_id: importerId,
        columns,
      });
    } catch (err) {
      console.error("DB error in GET /api/importers/:id/columns:", err);
      return c.json({ error: "Database error fetching importer columns" }, 500);
    }
  },
);
