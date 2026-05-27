import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { generateId } from "../lib/ids.js";
import { injectUserId } from "../lib/inject-user-id.js";
import { buildWebhookPayload } from "../lib/webhook-payload.js";
import type { BuildWebhookPayloadInput } from "../lib/webhook-payload.js";

const MAX_PAYLOAD_BYTES = 4 * 1024; // 4 KB

const batchIngestSchema = z.object({
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1),
});

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
    const idempotencyKey = c.req.header("Idempotency-Key") ?? null;

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
      // Idempotent replay: if this key already created an upload, return it unchanged.
      if (idempotencyKey) {
        const existing = await c.env.DB.prepare(
          "SELECT id, numeric_id, status FROM uploads WHERE idempotency_key = ?",
        )
          .bind(idempotencyKey)
          .first<{ id: string; numeric_id: number; status: string }>();
        if (existing) {
          return c.json(
            { upload_id: existing.id, numeric_id: existing.numeric_id, status: existing.status },
            200,
          );
        }
      }

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
          status, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
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
          idempotencyKey,
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
)
.post(
  "/:upload_id/batches/:batch_index",
  zValidator("json", batchIngestSchema),
  async (c) => {
    const uploadId = c.req.param("upload_id");
    const batchIndex = Number(c.req.param("batch_index"));
    const { rows } = c.req.valid("json");
    const session = c.get("session");

    if (!Number.isInteger(batchIndex) || batchIndex < 1) {
      return c.json({ error: "batch_index must be a positive integer" }, 400);
    }

    try {
      const upload = await c.env.DB.prepare(
        `SELECT u.id, u.numeric_id, u.file_name, u.matched_columns_map, u.uploaded_file_headers,
                u.user_payload, u.metadata_payload, u.total_rows, u.batch_count,
                ie.key AS importer_key
         FROM uploads u
         JOIN importer_environments ie ON ie.id = u.importer_environment_id
         WHERE u.id = ? AND u.project_id = ?`,
      )
        .bind(uploadId, session.project_id)
        .first<{
          id: string;
          numeric_id: number;
          file_name: string;
          matched_columns_map: string;
          uploaded_file_headers: string;
          user_payload: string | null;
          metadata_payload: string | null;
          total_rows: number;
          batch_count: number;
          importer_key: string;
        }>();

      if (!upload) {
        return c.json({ error: "Upload not found" }, 404);
      }
      if (batchIndex > upload.batch_count) {
        return c.json({ error: "batch_index exceeds batch_count" }, 400);
      }

      // Idempotent: if this batch is already persisted, return 204 without rewriting R2.
      const existing = await c.env.DB.prepare(
        "SELECT 1 FROM upload_batches WHERE upload_id = ? AND batch_index = ?",
      )
        .bind(uploadId, batchIndex)
        .first();
      if (existing) {
        return c.body(null, 204);
      }

      const payload = buildWebhookPayload({
        numericId: upload.numeric_id,
        importerKey: upload.importer_key,
        fileName: upload.file_name,
        matchedColumnsMap: JSON.parse(upload.matched_columns_map),
        uploadedFileHeaders: JSON.parse(upload.uploaded_file_headers),
        batchIndex,
        batchCount: upload.batch_count,
        totalRows: upload.total_rows,
        user: upload.user_payload ? JSON.parse(upload.user_payload) : null,
        metadata: upload.metadata_payload ? JSON.parse(upload.metadata_payload) : null,
        rows: rows as BuildWebhookPayloadInput["rows"],
      });

      const r2Key = `uploads/${uploadId}/batches/${batchIndex}.json`;
      await c.env.UPLOADS_BUCKET.put(r2Key, JSON.stringify(payload), {
        httpMetadata: { contentType: "application/json" },
      });

      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO upload_batches (upload_id, batch_index, r2_key, row_count, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(uploadId, batchIndex, r2Key, rows.length, now)
        .run();

      await c.env.DB.prepare(
        "UPDATE uploads SET status = 'dispatching', updated_at = ? WHERE id = ? AND status = 'pending'",
      )
        .bind(now, uploadId)
        .run();

      await c.env.WEBHOOK_QUEUE.send({ uploadId, batchIndex, attempt: 1 });

      return c.body(null, 204);
    } catch (err) {
      console.error("DB/R2 error in POST batch:", err);
      return c.json({ error: "Failed to persist batch" }, 500);
    }
  },
);
