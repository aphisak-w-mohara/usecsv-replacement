import type { Env } from "../env.js";

const DEFAULT_RETENTION_DAYS = 30;
// Bound work per cron tick so the first run after a long backlog can't blow the
// scheduled-worker CPU/subrequest budget. Remaining uploads drain on later ticks
// (they stay payload_purged_at IS NULL until purged).
const PURGE_BATCH_LIMIT = 500;

/**
 * Parse `RETENTION_DAYS` (a string env var) to a non-negative integer, else
 * default. `0` is honoured (purge delivered PII immediately) — only an
 * unset/negative/non-numeric value falls back to the default.
 */
function retentionDays(env: Env): number {
  const parsed = Number(env.RETENTION_DAYS);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULT_RETENTION_DAYS;
}

/**
 * Purge client PII from delivered uploads past the retention window.
 *
 * Batch payloads (the actual Property/Tenant rows) are gzipped into
 * `upload_batches.payload` and otherwise kept forever. Once an upload is
 * `completed` and older than `RETENTION_DAYS` (default 30), we NULL out the
 * payload of every batch for that upload while keeping the row + row_count, so
 * the errors.csv export and audit trail keep their shape (the export already
 * skips batches whose payload is null). We stamp `uploads.payload_purged_at` so
 * the same upload is not re-scanned on every cron tick.
 *
 * `nowSeconds` is injected (rather than read from Date.now()) so tests are
 * deterministic.
 *
 * Returns the number of uploads purged.
 */
export async function purgeDeliveredPayloads(env: Env, nowSeconds: number): Promise<number> {
  const cutoff = nowSeconds - retentionDays(env) * 24 * 60 * 60;

  const stale = await env.DB.prepare(
    `SELECT id FROM uploads
     WHERE status = 'completed' AND payload_purged_at IS NULL AND updated_at < ?
     LIMIT ?`,
  )
    .bind(cutoff, PURGE_BATCH_LIMIT)
    .all<{ id: string }>();
  const rows = stale.results ?? [];
  if (rows.length === 0) return 0;

  let purged = 0;
  for (const upload of rows) {
    await env.DB.prepare(
      "UPDATE upload_batches SET payload = NULL WHERE upload_id = ? AND payload IS NOT NULL",
    )
      .bind(upload.id)
      .run();
    await env.DB.prepare("UPDATE uploads SET payload_purged_at = ? WHERE id = ?")
      .bind(nowSeconds, upload.id)
      .run();
    purged++;
  }

  return purged;
}
