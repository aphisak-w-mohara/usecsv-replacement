import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { generateId } from "../lib/ids.js";

const importerCreateSchema = z.object({
  name: z.string().min(1).max(200),
});

const importerPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});

const COLUMN_NAME_RE = /^[a-z][a-z0-9_]*$/;
const VALIDATION_TYPES = [
  "string",
  "number",
  "email",
  "phone",
  "url",
  "date",
  "select",
  "regex",
] as const;

const columnCreateSchema = z.object({
  name: z.string().min(1).max(100).regex(COLUMN_NAME_RE),
  display_name: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  example: z.string().max(200).nullable().optional(),
  must_be_matched: z.boolean().optional(),
  value_cannot_be_blank: z.boolean().optional(),
  validation_type: z.enum(VALIDATION_TYPES).optional(),
  validation_format: z.string().max(500).nullable().optional(),
  custom_error_message: z.string().max(500).nullable().optional(),
});

const columnPatchSchema = z.object({
  name: z.string().min(1).max(100).regex(COLUMN_NAME_RE).optional(),
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  example: z.string().max(200).nullable().optional(),
  must_be_matched: z.boolean().optional(),
  value_cannot_be_blank: z.boolean().optional(),
  validation_type: z.enum(VALIDATION_TYPES).optional(),
  validation_format: z.string().max(500).nullable().optional(),
  custom_error_message: z.string().max(500).nullable().optional(),
});

type ColumnFullRow = {
  id: string;
  position: number;
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: number;
  value_cannot_be_blank: number;
  validation_type: string;
  validation_format: string | null;
  custom_error_message: string | null;
};

function shapeColumn(row: ColumnFullRow) {
  return {
    id: row.id,
    position: row.position,
    name: row.name,
    display_name: row.display_name,
    description: row.description,
    example: row.example,
    must_be_matched: Boolean(row.must_be_matched),
    value_cannot_be_blank: Boolean(row.value_cannot_be_blank),
    validation_type: row.validation_type,
    validation_format: row.validation_format,
    custom_error_message: row.custom_error_message,
  };
}

type ImporterListRow = {
  id: string;
  name: string;
  archived_at: number | null;
  updated_at: number;
  column_count: number;
  env_count: number;
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
  .post("/", zValidator("json", importerCreateSchema), async (c) => {
    const session = c.get("session");
    const name = c.req.valid("json").name.trim();

    if (name.length === 0) {
      return c.json({ error: "Importer name is required" }, 400);
    }

    try {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM importers WHERE project_id = ? AND lower(name) = lower(?)",
      )
        .bind(session.project_id, name)
        .first<{ id: string }>();

      if (existing) {
        return c.json({ error: "An importer with this name already exists" }, 409);
      }

      const id = generateId("imp");
      const now = Math.floor(Date.now() / 1000);

      await c.env.DB.prepare(
        `INSERT INTO importers (id, project_id, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(id, session.project_id, name, now, now)
        .run();

      return c.json(
        {
          importer: {
            id,
            name,
            column_count: 0,
            env_count: 0,
            archived: false,
            updated_at: now,
          },
        },
        201,
      );
    } catch (err) {
      // Backstop for the SELECT-then-INSERT race: the unique index on
      // (project_id, name COLLATE NOCASE) rejects a concurrent duplicate that
      // slipped past the pre-insert check. Surface the same friendly 409.
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        return c.json({ error: "An importer with this name already exists" }, 409);
      }
      console.error("DB error in POST /api/importers:", err);
      return c.json({ error: "Database error creating importer" }, 500);
    }
  })
  .get("/:importer_id", async (c) => {
    const importerId = c.req.param("importer_id");
    const session = c.get("session");

    try {
      const row = await c.env.DB.prepare(
        `SELECT i.id, i.name, i.archived_at, i.updated_at,
                (SELECT COUNT(*) FROM importer_columns ic WHERE ic.importer_id = i.id) AS column_count,
                (SELECT COUNT(*) FROM importer_environments ie WHERE ie.importer_id = i.id) AS env_count
         FROM importers i
         WHERE i.id = ? AND i.project_id = ?`,
      )
        .bind(importerId, session.project_id)
        .first<{
          id: string;
          name: string;
          archived_at: number | null;
          updated_at: number;
          column_count: number;
          env_count: number;
        }>();

      if (!row) {
        return c.json({ error: "Importer not found" }, 404);
      }

      return c.json({
        importer: {
          id: row.id,
          name: row.name,
          column_count: row.column_count,
          env_count: row.env_count,
          archived: row.archived_at !== null,
          updated_at: row.updated_at,
        },
      });
    } catch (err) {
      console.error("DB error in GET /api/importers/:id:", err);
      return c.json({ error: "Database error fetching importer" }, 500);
    }
  })
  .patch(
    "/:importer_id",
    zValidator("json", importerPatchSchema),
    async (c) => {
      const importerId = c.req.param("importer_id");
      const session = c.get("session");
      const body = c.req.valid("json");
      const trimmedName = body.name?.trim();

      if (body.name !== undefined && (!trimmedName || trimmedName.length === 0)) {
        return c.json({ error: "Importer name is required" }, 400);
      }

      try {
        // Project-scoped existence check. Cross-project → 404 (not 403) to match
        // the IDOR-resistance pattern set in PRD-002.
        const existing = await c.env.DB.prepare(
          "SELECT id FROM importers WHERE id = ? AND project_id = ?",
        )
          .bind(importerId, session.project_id)
          .first<{ id: string }>();

        if (!existing) {
          return c.json({ error: "Importer not found" }, 404);
        }

        const sets: string[] = [];
        const binds: (string | number | null)[] = [];

        if (trimmedName !== undefined) {
          const collision = await c.env.DB.prepare(
            "SELECT id FROM importers WHERE project_id = ? AND lower(name) = lower(?) AND id != ?",
          )
            .bind(session.project_id, trimmedName, importerId)
            .first<{ id: string }>();
          if (collision) {
            return c.json({ error: "An importer with this name already exists" }, 409);
          }
          sets.push("name = ?");
          binds.push(trimmedName);
        }

        if (body.archived !== undefined) {
          sets.push("archived_at = ?");
          binds.push(body.archived ? Math.floor(Date.now() / 1000) : null);
        }

        if (sets.length > 0) {
          const now = Math.floor(Date.now() / 1000);
          sets.push("updated_at = ?");
          binds.push(now);

          binds.push(importerId);
          await c.env.DB.prepare(
            `UPDATE importers SET ${sets.join(", ")} WHERE id = ?`,
          )
            .bind(...binds)
            .run();
        }

        // Project-scoped re-fetch (defense-in-depth) — mirrors every other
        // importer read in this file. If the existence check above passed and
        // the UPDATE succeeded but this returns null, something has gone wrong
        // mid-request (concurrent delete) — surface a 500.
        const row = await c.env.DB.prepare(
          `SELECT i.id, i.name, i.archived_at, i.updated_at,
                  (SELECT COUNT(*) FROM importer_columns ic WHERE ic.importer_id = i.id) AS column_count,
                  (SELECT COUNT(*) FROM importer_environments ie WHERE ie.importer_id = i.id) AS env_count
           FROM importers i WHERE i.id = ? AND i.project_id = ?`,
        )
          .bind(importerId, session.project_id)
          .first<{
            id: string;
            name: string;
            archived_at: number | null;
            updated_at: number;
            column_count: number;
            env_count: number;
          }>();

        if (!row) {
          return c.json({ error: "Importer disappeared during update" }, 500);
        }

        return c.json({
          importer: {
            id: row.id,
            name: row.name,
            column_count: row.column_count,
            env_count: row.env_count,
            archived: row.archived_at !== null,
            updated_at: row.updated_at,
          },
        });
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
          return c.json({ error: "An importer with this name already exists" }, 409);
        }
        console.error("DB error in PATCH /api/importers/:id:", err);
        return c.json({ error: "Database error updating importer" }, 500);
      }
    },
  )
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
        `SELECT id, position, name, display_name, description, example,
                must_be_matched, value_cannot_be_blank,
                validation_type, validation_format, custom_error_message
         FROM importer_columns
         WHERE importer_id = ?
         ORDER BY position ASC`,
      )
        .bind(importerId)
        .all<ColumnFullRow>();

      const columns = result.results.map(shapeColumn);

      return c.json({
        importer_id: importerId,
        columns,
      });
    } catch (err) {
      console.error("DB error in GET /api/importers/:id/columns:", err);
      return c.json({ error: "Database error fetching importer columns" }, 500);
    }
  })
  .post(
    "/:importer_id/columns",
    zValidator("json", columnCreateSchema),
    async (c) => {
      const importerId = c.req.param("importer_id");
      const session = c.get("session");
      const body = c.req.valid("json");

      try {
        const importer = await c.env.DB.prepare(
          "SELECT id FROM importers WHERE id = ? AND project_id = ?",
        )
          .bind(importerId, session.project_id)
          .first<{ id: string }>();
        if (!importer) {
          return c.json({ error: "Importer not found" }, 404);
        }

        const dup = await c.env.DB.prepare(
          "SELECT id FROM importer_columns WHERE importer_id = ? AND name = ?",
        )
          .bind(importerId, body.name)
          .first<{ id: string }>();
        if (dup) {
          return c.json({ error: "A column with this name already exists" }, 409);
        }

        const maxRow = await c.env.DB.prepare(
          "SELECT COALESCE(MAX(position), 0) AS max_pos FROM importer_columns WHERE importer_id = ?",
        )
          .bind(importerId)
          .first<{ max_pos: number }>();
        const position = (maxRow?.max_pos ?? 0) + 1;
        const id = generateId("col");

        await c.env.DB.prepare(
          `INSERT INTO importer_columns
             (id, importer_id, position, name, display_name, description, example,
              must_be_matched, value_cannot_be_blank,
              validation_type, validation_format, custom_error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            id,
            importerId,
            position,
            body.name,
            body.display_name,
            body.description ?? null,
            body.example ?? null,
            body.must_be_matched === false ? 0 : 1,
            body.value_cannot_be_blank === false ? 0 : 1,
            body.validation_type ?? "string",
            body.validation_format ?? null,
            body.custom_error_message ?? null,
          )
          .run();

        const now = Math.floor(Date.now() / 1000);
        await c.env.DB.prepare("UPDATE importers SET updated_at = ? WHERE id = ?")
          .bind(now, importerId)
          .run();

        const row = await c.env.DB.prepare(
          `SELECT id, position, name, display_name, description, example,
                  must_be_matched, value_cannot_be_blank,
                  validation_type, validation_format, custom_error_message
           FROM importer_columns WHERE id = ?`,
        )
          .bind(id)
          .first<ColumnFullRow>();

        return c.json({ column: shapeColumn(row!) }, 201);
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
          return c.json({ error: "A column with this name already exists" }, 409);
        }
        console.error("DB error in POST /api/importers/:id/columns:", err);
        return c.json({ error: "Database error creating column" }, 500);
      }
    },
  )
  .patch(
    "/:importer_id/columns/:column_id",
    zValidator("json", columnPatchSchema),
    async (c) => {
      const importerId = c.req.param("importer_id");
      const columnId = c.req.param("column_id");
      const session = c.get("session");
      const body = c.req.valid("json");

      try {
        const importer = await c.env.DB.prepare(
          "SELECT id FROM importers WHERE id = ? AND project_id = ?",
        )
          .bind(importerId, session.project_id)
          .first<{ id: string }>();
        if (!importer) {
          return c.json({ error: "Importer not found" }, 404);
        }

        const existing = await c.env.DB.prepare(
          "SELECT id FROM importer_columns WHERE id = ? AND importer_id = ?",
        )
          .bind(columnId, importerId)
          .first<{ id: string }>();
        if (!existing) {
          return c.json({ error: "Column not found" }, 404);
        }

        if (body.name !== undefined) {
          const dup = await c.env.DB.prepare(
            "SELECT id FROM importer_columns WHERE importer_id = ? AND name = ? AND id != ?",
          )
            .bind(importerId, body.name, columnId)
            .first<{ id: string }>();
          if (dup) {
            return c.json({ error: "A column with this name already exists" }, 409);
          }
        }

        const sets: string[] = [];
        const binds: (string | number | null)[] = [];

        if (body.name !== undefined) {
          sets.push("name = ?");
          binds.push(body.name);
        }
        if (body.display_name !== undefined) {
          sets.push("display_name = ?");
          binds.push(body.display_name);
        }
        if (body.description !== undefined) {
          sets.push("description = ?");
          binds.push(body.description);
        }
        if (body.example !== undefined) {
          sets.push("example = ?");
          binds.push(body.example);
        }
        if (body.must_be_matched !== undefined) {
          sets.push("must_be_matched = ?");
          binds.push(body.must_be_matched ? 1 : 0);
        }
        if (body.value_cannot_be_blank !== undefined) {
          sets.push("value_cannot_be_blank = ?");
          binds.push(body.value_cannot_be_blank ? 1 : 0);
        }
        if (body.validation_type !== undefined) {
          sets.push("validation_type = ?");
          binds.push(body.validation_type);
        }
        if (body.validation_format !== undefined) {
          sets.push("validation_format = ?");
          binds.push(body.validation_format);
        }
        if (body.custom_error_message !== undefined) {
          sets.push("custom_error_message = ?");
          binds.push(body.custom_error_message);
        }

        if (sets.length > 0) {
          binds.push(columnId);
          await c.env.DB.prepare(
            `UPDATE importer_columns SET ${sets.join(", ")} WHERE id = ?`,
          )
            .bind(...binds)
            .run();

          const now = Math.floor(Date.now() / 1000);
          await c.env.DB.prepare("UPDATE importers SET updated_at = ? WHERE id = ?")
            .bind(now, importerId)
            .run();
        }

        const row = await c.env.DB.prepare(
          `SELECT id, position, name, display_name, description, example,
                  must_be_matched, value_cannot_be_blank,
                  validation_type, validation_format, custom_error_message
           FROM importer_columns WHERE id = ?`,
        )
          .bind(columnId)
          .first<ColumnFullRow>();

        return c.json({ column: shapeColumn(row!) });
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
          return c.json({ error: "A column with this name already exists" }, 409);
        }
        console.error("DB error in PATCH /api/importers/:id/columns/:column_id:", err);
        return c.json({ error: "Database error updating column" }, 500);
      }
    },
  )
  .delete("/:importer_id/columns/:column_id", async (c) => {
    const importerId = c.req.param("importer_id");
    const columnId = c.req.param("column_id");
    const session = c.get("session");

    try {
      const importer = await c.env.DB.prepare(
        "SELECT id FROM importers WHERE id = ? AND project_id = ?",
      )
        .bind(importerId, session.project_id)
        .first<{ id: string }>();
      if (!importer) {
        return c.json({ error: "Importer not found" }, 404);
      }

      const existing = await c.env.DB.prepare(
        "SELECT id FROM importer_columns WHERE id = ? AND importer_id = ?",
      )
        .bind(columnId, importerId)
        .first<{ id: string }>();
      if (!existing) {
        return c.json({ error: "Column not found" }, 404);
      }

      await c.env.DB.prepare("DELETE FROM importer_columns WHERE id = ?")
        .bind(columnId)
        .run();

      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare("UPDATE importers SET updated_at = ? WHERE id = ?")
        .bind(now, importerId)
        .run();

      return c.body(null, 204);
    } catch (err) {
      console.error("DB error in DELETE /api/importers/:id/columns/:column_id:", err);
      return c.json({ error: "Database error deleting column" }, 500);
    }
  })
  .put(
    "/:importer_id/columns/order",
    zValidator(
      "json",
      z.object({ ordered_ids: z.array(z.string()).min(1) }),
    ),
    async (c) => {
      const importerId = c.req.param("importer_id");
      const session = c.get("session");
      const { ordered_ids } = c.req.valid("json");

      // Reject duplicates up-front for a clean 400.
      if (new Set(ordered_ids).size !== ordered_ids.length) {
        return c.json({ error: "Duplicate column ids in ordered_ids" }, 400);
      }

      try {
        const importer = await c.env.DB.prepare(
          "SELECT id FROM importers WHERE id = ? AND project_id = ?",
        )
          .bind(importerId, session.project_id)
          .first<{ id: string }>();
        if (!importer) {
          return c.json({ error: "Importer not found" }, 404);
        }

        const existing = await c.env.DB.prepare(
          "SELECT id FROM importer_columns WHERE importer_id = ?",
        )
          .bind(importerId)
          .all<{ id: string }>();
        const existingIds = new Set(existing.results.map((r) => r.id));

        if (existingIds.size !== ordered_ids.length) {
          return c.json(
            {
              error: `ordered_ids must contain exactly the ${existingIds.size} current column id(s); got ${ordered_ids.length}`,
            },
            400,
          );
        }
        for (const id of ordered_ids) {
          if (!existingIds.has(id)) {
            return c.json({ error: `Unknown column id: ${id}` }, 400);
          }
        }

        // Two-pass batch to avoid UNIQUE(importer_id, position) collisions:
        // first move every row to a negative temp slot, then to its final slot.
        const tempStmts = ordered_ids.map((id, i) =>
          c.env.DB.prepare(
            "UPDATE importer_columns SET position = ? WHERE id = ? AND importer_id = ?",
          ).bind(-1 - i, id, importerId),
        );
        const finalStmts = ordered_ids.map((id, i) =>
          c.env.DB.prepare(
            "UPDATE importer_columns SET position = ? WHERE id = ? AND importer_id = ?",
          ).bind(i + 1, id, importerId),
        );
        await c.env.DB.batch([...tempStmts, ...finalStmts]);

        const now = Math.floor(Date.now() / 1000);
        await c.env.DB.prepare("UPDATE importers SET updated_at = ? WHERE id = ?")
          .bind(now, importerId)
          .run();

        const result = await c.env.DB.prepare(
          `SELECT id, position, name, display_name, description, example,
                  must_be_matched, value_cannot_be_blank,
                  validation_type, validation_format, custom_error_message
           FROM importer_columns
           WHERE importer_id = ?
           ORDER BY position ASC`,
        )
          .bind(importerId)
          .all<ColumnFullRow>();

        return c.json({
          importer_id: importerId,
          columns: result.results.map(shapeColumn),
        });
      } catch (err) {
        console.error("DB error in PUT /api/importers/:id/columns/order:", err);
        return c.json({ error: "Database error reordering columns" }, 500);
      }
    },
  )
  .get("/:importer_id/environments", async (c) => {
    const importerId = c.req.param("importer_id");
    const session = c.get("session");

    try {
      const importer = await c.env.DB.prepare(
        "SELECT id FROM importers WHERE id = ? AND project_id = ?",
      )
        .bind(importerId, session.project_id)
        .first<{ id: string }>();
      if (!importer) {
        return c.json({ error: "Importer not found" }, 404);
      }

      const result = await c.env.DB.prepare(
        `SELECT e.id AS env_id, e.slug AS env_slug, e.name AS env_name, e.is_default,
                ie.id AS ie_id, ie.key, ie.webhook_url, ie.batch_size,
                ie.filter_invalid_rows, ie.include_unmatched_columns,
                ie.webhook_signing_enabled, ie.webhook_secret
         FROM environments e
         LEFT JOIN importer_environments ie
           ON ie.environment_id = e.id AND ie.importer_id = ?
         WHERE e.project_id = ?
         ORDER BY e.is_default DESC, e.slug ASC`,
      )
        .bind(importerId, session.project_id)
        .all<{
          env_id: string;
          env_slug: string;
          env_name: string;
          is_default: number;
          ie_id: string | null;
          key: string | null;
          webhook_url: string | null;
          batch_size: number | null;
          filter_invalid_rows: number | null;
          include_unmatched_columns: number | null;
          webhook_signing_enabled: number | null;
          webhook_secret: string | null;
        }>();

      const environments = result.results.map((row) => ({
        env_id: row.env_id,
        env_slug: row.env_slug,
        env_name: row.env_name,
        is_default: Boolean(row.is_default),
        configured: row.ie_id !== null,
        importer_environment:
          row.ie_id === null
            ? null
            : {
                id: row.ie_id,
                key: row.key!,
                webhook_url: row.webhook_url!,
                batch_size: row.batch_size!,
                filter_invalid_rows: Boolean(row.filter_invalid_rows),
                include_unmatched_columns: Boolean(row.include_unmatched_columns),
                webhook_signing_enabled: Boolean(row.webhook_signing_enabled),
                secret_set: row.webhook_secret !== null,
              },
      }));

      return c.json({ environments });
    } catch (err) {
      console.error("DB error in GET /api/importers/:id/environments:", err);
      return c.json({ error: "Database error listing environments" }, 500);
    }
  })
  .put(
    "/:importer_id/environments/:env_id",
    zValidator(
      "json",
      z.object({
        webhook_url: z
          .string()
          .min(1)
          .refine((u) => /^https?:\/\//i.test(u), "must be http(s)"),
        batch_size: z.number().int().min(1).max(50000).optional(),
        filter_invalid_rows: z.boolean().optional(),
        include_unmatched_columns: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const importerId = c.req.param("importer_id");
      const envId = c.req.param("env_id");
      const session = c.get("session");
      const body = c.req.valid("json");

      try {
        const importer = await c.env.DB.prepare(
          "SELECT id FROM importers WHERE id = ? AND project_id = ?",
        )
          .bind(importerId, session.project_id)
          .first<{ id: string }>();
        if (!importer) {
          return c.json({ error: "Importer not found" }, 404);
        }

        const envRow = await c.env.DB.prepare(
          "SELECT id FROM environments WHERE id = ? AND project_id = ?",
        )
          .bind(envId, session.project_id)
          .first<{ id: string }>();
        if (!envRow) {
          return c.json({ error: "Environment not found" }, 404);
        }

        const existing = await c.env.DB.prepare(
          "SELECT id, key FROM importer_environments WHERE importer_id = ? AND environment_id = ?",
        )
          .bind(importerId, envId)
          .first<{ id: string; key: string }>();

        const batchSize = body.batch_size ?? 1000;
        const filterInvalid = body.filter_invalid_rows ? 1 : 0;
        const includeUnmatched = body.include_unmatched_columns ? 1 : 0;

        if (existing) {
          await c.env.DB.prepare(
            `UPDATE importer_environments
               SET webhook_url = ?, batch_size = ?,
                   filter_invalid_rows = ?, include_unmatched_columns = ?
             WHERE id = ?`,
          )
            .bind(body.webhook_url, batchSize, filterInvalid, includeUnmatched, existing.id)
            .run();
        } else {
          const id = generateId("impenv");
          const key = crypto.randomUUID();
          await c.env.DB.prepare(
            `INSERT INTO importer_environments
               (id, importer_id, environment_id, key, webhook_url, batch_size,
                filter_invalid_rows, include_unmatched_columns)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              id,
              importerId,
              envId,
              key,
              body.webhook_url,
              batchSize,
              filterInvalid,
              includeUnmatched,
            )
            .run();
        }

        const now = Math.floor(Date.now() / 1000);
        await c.env.DB.prepare("UPDATE importers SET updated_at = ? WHERE id = ?")
          .bind(now, importerId)
          .run();

        const row = await c.env.DB.prepare(
          `SELECT id, key, webhook_url, batch_size,
                  filter_invalid_rows, include_unmatched_columns,
                  webhook_signing_enabled, webhook_secret
           FROM importer_environments
           WHERE importer_id = ? AND environment_id = ?`,
        )
          .bind(importerId, envId)
          .first<{
            id: string;
            key: string;
            webhook_url: string;
            batch_size: number;
            filter_invalid_rows: number;
            include_unmatched_columns: number;
            webhook_signing_enabled: number;
            webhook_secret: string | null;
          }>();

        return c.json({
          importer_environment: {
            id: row!.id,
            key: row!.key,
            webhook_url: row!.webhook_url,
            batch_size: row!.batch_size,
            filter_invalid_rows: Boolean(row!.filter_invalid_rows),
            include_unmatched_columns: Boolean(row!.include_unmatched_columns),
            webhook_signing_enabled: Boolean(row!.webhook_signing_enabled),
            secret_set: row!.webhook_secret !== null,
          },
        });
      } catch (err) {
        console.error("DB error in PUT /api/importers/:id/environments/:env_id:", err);
        return c.json({ error: "Database error saving env config" }, 500);
      }
    },
  );
