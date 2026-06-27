import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { gunzipToString, gzipString } from "../lib/gzip.js";
import { generateId } from "../lib/ids.js";
import { injectUserId } from "../lib/inject-user-id.js";
import { buildWebhookPayload } from "../lib/webhook-payload.js";
import type { BuildWebhookPayloadInput } from "../lib/webhook-payload.js";

const MAX_PAYLOAD_BYTES = 4 * 1024; // 4 KB

// Server-side upload caps. The wizard advertises "Max 50,000 rows / 25 MB"
// (apps/web/.../step-upload-file.tsx) but enforces it only client-side; the
// server is authoritative, so we mirror those limits here as defence-in-depth.
// Oversized batch payloads are stored gzipped inline in D1 and risk hitting
// D1 statement/row-size limits, so each batch is also byte-capped.

// Whole-file row ceiling — matches the client "Max 50,000 rows" promise.
const MAX_TOTAL_ROWS = 50_000;
// Largest batch the client is allowed to declare. The wizard uses a fixed
// batch size of 1,000 (importers.$id_.upload.tsx); 5,000 leaves generous
// headroom without letting a single batch grow unbounded.
const MAX_BATCH_SIZE = 5_000;
// Upper bound on declared batch_count. With MAX_TOTAL_ROWS rows and the
// smallest sane batch (1 row/batch would be absurd), a generous flat cap of
// 5,000 covers every realistic chunking of a 50k-row file.
const MAX_BATCH_COUNT = 5_000;
// Per-batch row ceiling on the ingest endpoint — matches MAX_BATCH_SIZE so a
// single batch can never carry more rows than the largest declared batch_size.
const MAX_BATCH_ROWS = 5_000;
// Per-batch serialized-byte ceiling — mirrors the client 25 MB whole-file
// story. No single batch may exceed the entire allowed file size.
const MAX_BATCH_BYTES = 25 * 1024 * 1024; // 25 MB

const batchIngestSchema = z.object({
  rows: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(1)
    .max(MAX_BATCH_ROWS),
});

const uploadCreateSchema = z.object({
  importer_environment_id: z.string(),
  file_name: z.string().min(1).max(512),
  file_size: z.number().int().nonnegative(),
  matched_columns_map: z.record(z.string(), z.string()),
  uploaded_file_headers: z.array(z.string()),
  total_rows: z.number().int().positive().max(MAX_TOTAL_ROWS),
  batch_size: z.number().int().positive().max(MAX_BATCH_SIZE),
  batch_count: z.number().int().positive().max(MAX_BATCH_COUNT),
  user_payload: z.record(z.string(), z.unknown()).nullable(),
  metadata_payload: z.record(z.string(), z.unknown()).nullable(),
});

function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const uploadsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .post("/", zValidator("json", uploadCreateSchema), async (c) => {
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

    // Internal consistency: batch_count must be exactly the chunking of
    // total_rows at batch_size. Capping the three independently isn't enough —
    // a mismatch lets a client under-declare batch_count (so the final-batch
    // trigger fires while rows are silently never sent) or over-declare empty
    // trailing batches.
    if (body.batch_count !== Math.ceil(body.total_rows / body.batch_size)) {
      return c.json({ error: "batch_count must equal ceil(total_rows / batch_size)" }, 400);
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

      // Verify the importer_environment exists, belongs to the active project,
      // AND its parent importer isn't archived. Archived importers must not
      // accept new uploads — they exist only for the historical audit trail.
      const impEnv = await c.env.DB.prepare(
        `SELECT ie.id, i.project_id
         FROM importer_environments ie
         JOIN importers i ON i.id = ie.importer_id
         WHERE ie.id = ? AND i.project_id = ? AND i.archived_at IS NULL`,
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
          matched_columns_map, uploaded_file_headers,
          user_payload, metadata_payload, total_rows, batch_size, batch_count,
          status, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
        .bind(
          uploadId,
          seq.value,
          session.project_id,
          body.importer_environment_id,
          body.file_name,
          body.file_size,
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
  })
  .post("/:upload_id/batches/:batch_index", zValidator("json", batchIngestSchema), async (c) => {
    const uploadId = c.req.param("upload_id");
    const batchIndex = Number(c.req.param("batch_index"));
    const { rows } = c.req.valid("json");
    const session = c.get("session");

    if (!Number.isInteger(batchIndex) || batchIndex < 1) {
      return c.json({ error: "batch_index must be a positive integer" }, 400);
    }

    // Serialized-byte cap: the row array is stored gzipped inline in D1, so a
    // single oversized batch risks D1 statement/row-size limits. The zod schema
    // already caps the row COUNT (MAX_BATCH_ROWS); this also bounds the bytes.
    if (jsonByteSize(rows) > MAX_BATCH_BYTES) {
      return c.json({ error: "Batch payload too large — keep each batch under 25 MB" }, 413);
    }

    try {
      const upload = await c.env.DB.prepare(
        `SELECT u.id, u.numeric_id, u.file_name, u.matched_columns_map, u.uploaded_file_headers,
                u.user_payload, u.metadata_payload, u.total_rows, u.batch_size, u.batch_count,
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
          batch_size: number;
          batch_count: number;
          importer_key: string;
        }>();

      if (!upload) {
        return c.json({ error: "Upload not found" }, 404);
      }
      if (batchIndex > upload.batch_count) {
        return c.json({ error: "batch_index exceeds batch_count" }, 400);
      }
      // A batch may never carry more rows than the upload's declared batch_size
      // — otherwise the persisted payload contradicts the upload's row/batch
      // accounting that the webhook (and Laravel's final-batch logic) rely on.
      if (rows.length > upload.batch_size) {
        return c.json({ error: "batch carries more rows than the declared batch_size" }, 400);
      }

      // Idempotent: if this batch is already persisted, return 204 without rewriting it.
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

      // Persist the canonical payload inline in D1 (gzipped BLOB). The
      // (upload_id, batch_index) PK + ON CONFLICT DO NOTHING preserves the
      // idempotent "skip if already persisted" semantic the R2 key path had.
      const gz = await gzipString(JSON.stringify(payload));
      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO upload_batches (upload_id, batch_index, payload, payload_encoding, row_count, created_at)
         VALUES (?, ?, ?, 'gzip', ?, ?)
         ON CONFLICT(upload_id, batch_index) DO NOTHING`,
      )
        .bind(uploadId, batchIndex, gz, rows.length, now)
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
  })
  .get("/:upload_id", async (c) => {
    const uploadId = c.req.param("upload_id");
    const session = c.get("session");

    try {
      const upload = await c.env.DB.prepare(
        "SELECT id, numeric_id, status, batch_count FROM uploads WHERE id = ? AND project_id = ?",
      )
        .bind(uploadId, session.project_id)
        .first<{ id: string; numeric_id: number; status: string; batch_count: number }>();
      if (!upload) {
        return c.json({ error: "Upload not found" }, 404);
      }

      const attempts = await c.env.DB.prepare(
        `SELECT batch_index, attempt_number, status_code, response_body, errors_json
       FROM webhook_attempts WHERE upload_id = ?
       ORDER BY started_at ASC, attempt_number ASC`,
      )
        .bind(uploadId)
        .all<{
          batch_index: number;
          attempt_number: number;
          status_code: number | null;
          response_body: string | null;
          errors_json: string | null;
        }>();

      const rows = attempts.results ?? [];

      const deliveredSet = new Set<number>();
      const rowErrors: Array<{ row: number; msg: string }> = [];
      for (const a of rows) {
        if (a.status_code !== null && a.status_code >= 200 && a.status_code < 300) {
          deliveredSet.add(a.batch_index);
        }
        if (a.errors_json) {
          try {
            const parsed = JSON.parse(a.errors_json) as Array<{ row: number; msg: string }>;
            for (const e of parsed) rowErrors.push(e);
          } catch {
            // ignore malformed errors_json
          }
        }
      }

      const last = rows.length > 0 ? rows[rows.length - 1]! : null;

      return c.json({
        upload_id: upload.id,
        numeric_id: upload.numeric_id,
        status: upload.status,
        batch_count: upload.batch_count,
        batches_delivered: deliveredSet.size,
        latest_attempt: last
          ? {
              batch_index: last.batch_index,
              attempt_number: last.attempt_number,
              status_code: last.status_code,
              response_body: last.response_body,
            }
          : null,
        row_errors: rowErrors,
        has_row_errors: rowErrors.length > 0,
      });
    } catch (err) {
      console.error("DB error in GET upload status:", err);
      return c.json({ error: "Failed to load upload status" }, 500);
    }
  })
  .post("/:upload_id/retry", async (c) => {
    const uploadId = c.req.param("upload_id");
    const session = c.get("session");

    try {
      const upload = await c.env.DB.prepare(
        "SELECT id, batch_count FROM uploads WHERE id = ? AND project_id = ?",
      )
        .bind(uploadId, session.project_id)
        .first<{ id: string; batch_count: number }>();
      if (!upload) return c.json({ error: "Upload not found" }, 404);

      // Find batches with no 2xx attempt and re-enqueue each (attempt restarts at 1).
      const attempts = await c.env.DB.prepare(
        "SELECT batch_index, status_code FROM webhook_attempts WHERE upload_id = ?",
      )
        .bind(uploadId)
        .all<{ batch_index: number; status_code: number | null }>();
      const delivered = new Set<number>();
      for (const a of attempts.results ?? []) {
        if (a.status_code !== null && a.status_code >= 200 && a.status_code < 300) {
          delivered.add(a.batch_index);
        }
      }

      for (let i = 1; i <= upload.batch_count; i++) {
        if (!delivered.has(i)) {
          // Clear prior attempts so the retried delivery gets a fresh attempt-number
          // slot (otherwise INSERT OR IGNORE in the consumer silently drops it and the
          // upload can never leave 'halted'). This also resets the 6-attempt budget.
          await c.env.DB.prepare(
            "DELETE FROM webhook_attempts WHERE upload_id = ? AND batch_index = ?",
          )
            .bind(uploadId, i)
            .run();
          await c.env.WEBHOOK_QUEUE.send({ uploadId, batchIndex: i, attempt: 1 });
        }
      }

      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        "UPDATE uploads SET status = 'dispatching', updated_at = ? WHERE id = ?",
      )
        .bind(now, uploadId)
        .run();

      return c.json({ ok: true }, 202);
    } catch (err) {
      console.error("DB error in retry:", err);
      return c.json({ error: "Failed to retry" }, 500);
    }
  })
  .get("/:upload_id/errors.csv", async (c) => {
    const uploadId = c.req.param("upload_id");
    const session = c.get("session");

    try {
      const upload = await c.env.DB.prepare(
        "SELECT id FROM uploads WHERE id = ? AND project_id = ?",
      )
        .bind(uploadId, session.project_id)
        .first<{ id: string }>();
      if (!upload) return c.json({ error: "Upload not found" }, 404);

      // Collect row errors across all attempts.
      const attempts = await c.env.DB.prepare(
        "SELECT errors_json FROM webhook_attempts WHERE upload_id = ?",
      )
        .bind(uploadId)
        .all<{ errors_json: string | null }>();
      const errorMap = new Map<number, string>();
      for (const a of attempts.results ?? []) {
        if (!a.errors_json) continue;
        try {
          for (const e of JSON.parse(a.errors_json) as Array<{ row: number; msg: string }>) {
            errorMap.set(e.row, e.msg);
          }
        } catch {
          // skip malformed
        }
      }

      // Read original rows from the persisted batch payloads (gzipped in D1).
      const batches = await c.env.DB.prepare(
        "SELECT payload FROM upload_batches WHERE upload_id = ? ORDER BY batch_index ASC",
      )
        .bind(uploadId)
        .all<{ payload: ArrayBuffer | null }>();

      const rowByNumber = new Map<number, Record<string, string | number>>();
      const columnKeys: string[] = [];
      for (const b of batches.results ?? []) {
        if (!b.payload) continue;
        const payload = JSON.parse(await gunzipToString(b.payload)) as {
          rows: Array<Record<string, string | number>>;
        };
        for (const row of payload.rows) {
          rowByNumber.set(Number(row.row), row);
          for (const k of Object.keys(row)) {
            if (k !== "row" && !columnKeys.includes(k)) columnKeys.push(k);
          }
        }
      }

      const csvEscape = (v: unknown): string => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const header = ["row", ...columnKeys, "error_message"];
      const lines = [header.map(csvEscape).join(",")];
      for (const [rowNum, msg] of [...errorMap.entries()].sort((a, b) => a[0] - b[0])) {
        const row = rowByNumber.get(rowNum) ?? {};
        const cells = [rowNum, ...columnKeys.map((k) => row[k] ?? ""), msg];
        lines.push(cells.map(csvEscape).join(","));
      }

      return c.body(lines.join("\n"), 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="upload-${uploadId}-errors.csv"`,
      });
    } catch (err) {
      console.error("DB/R2 error in errors.csv:", err);
      return c.json({ error: "Failed to build error CSV" }, 500);
    }
  });
