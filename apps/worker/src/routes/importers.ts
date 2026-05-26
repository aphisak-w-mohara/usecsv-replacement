import { Hono } from "hono";
import type { Env, Variables } from "../env.js";

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

export const importersRoutes = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/:importer_id/columns",
  async (c) => {
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
