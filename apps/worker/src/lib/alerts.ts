import type { Env } from "../env.js";

/**
 * Scan for uploads that have reached status='halted' but have not yet been
 * alerted (`halt_alerted_at IS NULL`), and POST one operator-visible alert per
 * upload to the Slack incoming-webhook in `ALERT_WEBHOOK_URL`.
 *
 * Cloudflare cannot see this app-level "halted" state (it lives in D1), so the
 * scheduled worker is the only thing that can surface it. An upload is alerted
 * at most once: `halt_alerted_at` is stamped after a successful (or unset-webhook)
 * notification so subsequent cron ticks skip it.
 *
 * Best-effort by design — `halt_alerted_at` is stamped ONLY after an alert is
 * actually delivered to Slack, so it never marks a halt "alerted" that an
 * operator can't see:
 *  - If `ALERT_WEBHOOK_URL` is unset, log via console.warn and leave the upload
 *    un-stamped, so once the webhook is configured the backlog is delivered.
 *  - If the Slack POST fails (non-2xx / network / timeout), the upload is left
 *    un-stamped so the next run retries it; the error is logged, not thrown.
 *
 * `fetchImpl` is injectable so tests can stub the network deterministically.
 *
 * Returns the number of uploads for which an alert was successfully delivered.
 */
// Bound work per cron tick so a mass-halt event can't fire unbounded serial
// POSTs in one invocation; the remainder drains on later ticks.
const ALERT_BATCH_LIMIT = 100;
// Cap each webhook POST so one hanging endpoint can't stall the whole loop.
const WEBHOOK_TIMEOUT_MS = 5_000;

export async function alertHaltedUploads(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const halted = await env.DB.prepare(
    "SELECT id, numeric_id, file_name FROM uploads WHERE status = 'halted' AND halt_alerted_at IS NULL LIMIT ?",
  )
    .bind(ALERT_BATCH_LIMIT)
    .all<{ id: string; numeric_id: number; file_name: string }>();
  const rows = halted.results ?? [];
  if (rows.length === 0) return 0;

  const now = Math.floor(Date.now() / 1000);
  let alerted = 0;

  for (const upload of rows) {
    const text = `:rotating_light: evo-csv upload halted: #${upload.numeric_id} ("${upload.file_name}", id ${upload.id}). Webhook dispatch exhausted all retries; client data was NOT fully delivered. Open the upload's status page to retry.`;

    if (!env.ALERT_WEBHOOK_URL) {
      // Leave un-stamped: deliver once a webhook is configured.
      console.warn(`alertHaltedUploads: ALERT_WEBHOOK_URL unset; halted upload ${upload.id}`);
      continue;
    }

    try {
      const res = await fetchImpl(env.ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (res.status < 200 || res.status >= 300) {
        console.error(`alertHaltedUploads: webhook returned ${res.status} for upload ${upload.id}`);
        continue; // leave un-stamped so the next run retries.
      }
    } catch (err) {
      console.error(`alertHaltedUploads: webhook POST failed for upload ${upload.id}:`, err);
      continue; // leave un-stamped so the next run retries.
    }

    await env.DB.prepare("UPDATE uploads SET halt_alerted_at = ? WHERE id = ?")
      .bind(now, upload.id)
      .run();
    alerted++;
  }

  return alerted;
}
