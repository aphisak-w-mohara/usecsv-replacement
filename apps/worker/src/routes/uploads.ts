import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { generateId } from "../lib/ids.js";
import { injectUserId } from "../lib/inject-user-id.js";

const MAX_PAYLOAD_BYTES = 4 * 1024; // 4 KB

const uploadCreateSchema = z.object({
  importer_environment_id: z.string(),
  file_name: z.string().min(1).max(512),
  file_size: z.number().int().nonnegative(),
  matched_columns_map: z.record(z.string(), z.string()),
  uploaded_file_headers: z.array(z.string()),
  total_rows: z.number().int().positive(),
  batch_size: z.number().int().positive(),
  batch_count: z.number().int().positive(),
  user_payload: z.record(z.string(), z.unknown()).nullable(),
  metadata_payload: z.record(z.string(), z.unknown()).nullable(),
});

function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const uploadsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>().post(
  "/",
  zValidator("json", uploadCreateSchema),
  async (c) => {
    const body = c.req.valid("json");
    const session = c.get("session");

    // Size guards: each JSON payload independently capped at 4 KB.
    if (body.user_payload && jsonByteSize(body.user_payload) > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "user_payload too large — keep it under 4 KB" }, 400);
    }
    if (body.metadata_payload && jsonByteSize(body.metadata_payload) > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "metadata_payload too large — keep it under 4 KB" }, 400);
    }
    if (jsonByteSize(body.matched_columns_map) > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "matched_columns_map too large — keep it under 4 KB" }, 400);
    }
    if (jsonByteSize(body.uploaded_file_headers) > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "uploaded_file_headers too large — keep it under 4 KB" }, 400);
    }

    try {
      // Verify the importer_environment exists and belongs to the active project.
      const impEnv = await c.env.DB.prepare(
        `SELECT ie.id, i.project_id
         FROM importer_environments ie
         JOIN importers i ON i.id = ie.importer_id
         WHERE ie.id = ? AND i.project_id = ?`,
      )
        .bind(body.importer_environment_id, session.project_id)
        .first<{ id: string; project_id: string }>();

      if (!impEnv) {
        return c.json({ error: "Importer environment not found" }, 404);
      }

      // Inject session email as userId when the caller didn't provide one.
      const finalUserPayload = injectUserId(body.user_payload, session.user.email);

      // Atomic numeric_id increment from the sequences table.
      const seq = await c.env.DB.prepare(
        "UPDATE sequences SET value = value + 1 WHERE name = 'upload_numeric' RETURNING value",
      ).first<{ value: number }>();
      if (!seq) {
        return c.json({ error: "sequences row missing — migration not applied" }, 500);
      }

      const uploadId = generateId("upl");
      const now = Math.floor(Date.now() / 1000);

      await c.env.DB.prepare(
        `INSERT INTO uploads (
          id, numeric_id, project_id, importer_environment_id, file_name, file_size,
          r2_source_key, matched_columns_map, uploaded_file_headers,
          user_payload, metadata_payload, total_rows, batch_size, batch_count,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
        .bind(
          uploadId,
          seq.value,
          session.project_id,
          body.importer_environment_id,
          body.file_name,
          body.file_size,
          `uploads/${uploadId}/source.csv`,
          JSON.stringify(body.matched_columns_map),
          JSON.stringify(body.uploaded_file_headers),
          finalUserPayload === null ? null : JSON.stringify(finalUserPayload),
          body.metadata_payload === null ? null : JSON.stringify(body.metadata_payload),
          body.total_rows,
          body.batch_size,
          body.batch_count,
          now,
          now,
        )
        .run();

      return c.json(
        {
          upload_id: uploadId,
          numeric_id: seq.value,
          status: "pending",
        },
        201,
      );
    } catch (err) {
      console.error("DB error in POST /api/uploads:", err);
      return c.json({ error: "Database error creating upload" }, 500);
    }
  },
);
