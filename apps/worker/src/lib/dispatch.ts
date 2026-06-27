import type { WebhookDispatchJob } from "@evo-csv/shared";
import type { Env } from "../env.js";
import { gunzipToString } from "./gzip.js";
import { generateId } from "./ids.js";

const MAX_ATTEMPTS = 6;
// Exponential backoff in seconds: 10s, 30s, 2m, 10m, 1h, 6h. Index = attempt-1.
const BACKOFF_SECONDS = [10, 30, 120, 600, 3600, 21600];
const RESPONSE_BODY_CAP = 16 * 1024;

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** HMAC-SHA256 over `${timestamp}.${rawBody}`, lowercase hex. */
async function signPayload(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

/**
 * Recompute uploads.status from the full set of webhook_attempts.
 *  - completed: every batch_index in 1..batch_count has a 2xx attempt
 *  - halted:    some batch has MAX_ATTEMPTS attempts and none of them 2xx
 *  - dispatching: otherwise (still in flight / retrying)
 */
export async function recomputeUploadStatus(env: Env, uploadId: string): Promise<void> {
  const upload = await env.DB.prepare("SELECT batch_count FROM uploads WHERE id = ?")
    .bind(uploadId)
    .first<{ batch_count: number }>();
  if (!upload) return;

  const attempts = await env.DB.prepare(
    "SELECT batch_index, attempt_number, status_code FROM webhook_attempts WHERE upload_id = ?",
  )
    .bind(uploadId)
    .all<{ batch_index: number; attempt_number: number; status_code: number | null }>();
  const rows = attempts.results ?? [];

  const delivered = new Set<number>();
  const attemptsByBatch = new Map<number, number>();
  for (const a of rows) {
    if (a.status_code !== null && isSuccess(a.status_code)) delivered.add(a.batch_index);
    attemptsByBatch.set(
      a.batch_index,
      Math.max(attemptsByBatch.get(a.batch_index) ?? 0, a.attempt_number),
    );
  }

  // Phase 1: halted if any undelivered batch has exhausted its attempts.
  let status = "dispatching";
  for (let i = 1; i <= upload.batch_count; i++) {
    if (!delivered.has(i) && (attemptsByBatch.get(i) ?? 0) >= MAX_ATTEMPTS) {
      status = "halted";
      break;
    }
  }
  // Phase 2: completed only if every batch has a 2xx delivery and we're not halted.
  if (status !== "halted") {
    let allDelivered = true;
    for (let i = 1; i <= upload.batch_count; i++) {
      if (!delivered.has(i)) {
        allDelivered = false;
        break;
      }
    }
    if (allDelivered) status = "completed";
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE uploads SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, now, uploadId)
    .run();
}

/**
 * Deliver one batch. Reads the persisted (gzipped) payload from D1, POSTs it to the
 * importer-environment webhook URL (HMAC-signed when enabled), writes a
 * webhook_attempts row, recomputes upload status, and re-enqueues on failure
 * until MAX_ATTEMPTS.
 *
 * `fetchImpl` is injectable so tests can stub the network deterministically.
 */
export async function dispatchBatch(
  env: Env,
  job: WebhookDispatchJob,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { uploadId, batchIndex, attempt } = job;

  const cfg = await env.DB.prepare(
    `SELECT ie.webhook_url, ie.webhook_signing_enabled, ie.webhook_secret
     FROM uploads u JOIN importer_environments ie ON ie.id = u.importer_environment_id
     WHERE u.id = ?`,
  )
    .bind(uploadId)
    .first<{
      webhook_url: string | null;
      webhook_signing_enabled: number;
      webhook_secret: string | null;
    }>();
  if (!cfg) {
    console.error(`dispatchBatch: no upload/importer_environment for upload ${uploadId}`);
    return;
  }
  if (!cfg.webhook_url) {
    console.error(`dispatchBatch: no webhook_url for upload ${uploadId}`);
    return;
  }

  const batch = await env.DB.prepare(
    "SELECT payload FROM upload_batches WHERE upload_id = ? AND batch_index = ?",
  )
    .bind(uploadId, batchIndex)
    .first<{ payload: ArrayBuffer | null }>();
  if (!batch?.payload) {
    // Batch not persisted yet — re-enqueue shortly (covers any ingest/dispatch race).
    // D1 is strongly consistent (single primary), so this is a belt-and-suspenders
    // guard against a job that somehow runs before its INSERT commits.
    await env.WEBHOOK_QUEUE.send(job, { delaySeconds: 5 });
    return;
  }
  const rawBody = await gunzipToString(batch.payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "evo-csv/0.1 (+https://app.evo-csv)",
  };
  if (cfg.webhook_signing_enabled === 1 && cfg.webhook_secret) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers["X-Evo-Timestamp"] = ts;
    headers["X-Evo-Signature"] = await signPayload(cfg.webhook_secret, ts, rawBody);
  }

  const startedAt = Math.floor(Date.now() / 1000);
  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorsJson: string | null = null;

  try {
    const res = await fetchImpl(cfg.webhook_url, { method: "POST", headers, body: rawBody });
    statusCode = res.status;
    const text = await res.text();
    responseBody = text.slice(0, RESPONSE_BODY_CAP);
    if (isSuccess(res.status)) {
      try {
        const parsed = JSON.parse(text) as { errors?: Array<{ row: number; msg: string }> };
        if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
          errorsJson = JSON.stringify(parsed.errors);
        }
      } catch {
        // Non-JSON 2xx body — treat as success with no row errors.
      }
    }
  } catch (err) {
    statusCode = null; // network/timeout
    responseBody = err instanceof Error ? err.message.slice(0, RESPONSE_BODY_CAP) : "fetch failed";
  }

  const finishedAt = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_attempts
      (id, upload_id, batch_index, attempt_number, status_code, response_body, errors_json, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      generateId("wha"),
      uploadId,
      batchIndex,
      attempt,
      statusCode,
      responseBody,
      errorsJson,
      startedAt,
      finishedAt,
    )
    .run();

  const ok = statusCode !== null && isSuccess(statusCode);
  if (!ok && attempt < MAX_ATTEMPTS) {
    const delay = BACKOFF_SECONDS[attempt - 1] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]!;
    await env.WEBHOOK_QUEUE.send(
      { uploadId, batchIndex, attempt: attempt + 1 },
      { delaySeconds: delay },
    );
  }

  await recomputeUploadStatus(env, uploadId);
}
