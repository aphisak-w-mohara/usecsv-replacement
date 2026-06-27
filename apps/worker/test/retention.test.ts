import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { purgeDeliveredPayloads, purgeStaleRateLimits } from "../src/lib/retention";
import { authedFetch } from "./helpers/auth.js";

const NOW = 1_800_000_000; // fixed "now" in unix seconds for deterministic tests.
const DAY = 24 * 60 * 60;

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "t.csv",
  file_size: 64,
  matched_columns_map: { first_name: "First name" },
  uploaded_file_headers: ["First name"],
  total_rows: 1,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

/** Create an upload with batch 1 persisted, then force status + updated_at. */
async function seedUpload(status: string, updatedAt: number): Promise<string> {
  const created = await (
    await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(UPLOAD_BODY),
    })
  ).json<{ upload_id: string }>();
  await authedFetch(`https://example.com/api/uploads/${created.upload_id}/batches/1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [{ row: 1, first_name: "Alice" }] }),
  });
  await env.DB.prepare("UPDATE uploads SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, updatedAt, created.upload_id)
    .run();
  return created.upload_id;
}

async function payloadPresent(uploadId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT payload FROM upload_batches WHERE upload_id = ? AND batch_index = 1",
  )
    .bind(uploadId)
    .first<{ payload: ArrayBuffer | null }>();
  return row?.payload != null;
}

describe("purgeDeliveredPayloads", () => {
  it("purges completed uploads older than the retention window and stamps payload_purged_at", async () => {
    const oldDelivered = await seedUpload("completed", NOW - 31 * DAY);
    expect(await payloadPresent(oldDelivered)).toBe(true);

    const env30 = { ...env, RETENTION_DAYS: "30" } as Env;
    const purged = await purgeDeliveredPayloads(env30, NOW);

    // Shared storage: other suites may add purgeable uploads, so assert >= 1
    // and verify our specific upload was the one purged.
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await payloadPresent(oldDelivered)).toBe(false);
    // row + row_count kept so errors.csv/audit still has the shape.
    const row = await env.DB.prepare(
      "SELECT row_count FROM upload_batches WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(oldDelivered)
      .first<{ row_count: number }>();
    expect(row?.row_count).toBe(1);
    const upload = await env.DB.prepare("SELECT payload_purged_at FROM uploads WHERE id = ?")
      .bind(oldDelivered)
      .first<{ payload_purged_at: number }>();
    expect(upload?.payload_purged_at).toBe(NOW);
  });

  it("leaves recent completed uploads and non-completed old uploads untouched", async () => {
    const recentDelivered = await seedUpload("completed", NOW - 5 * DAY);
    const oldHalted = await seedUpload("halted", NOW - 100 * DAY);
    const oldDispatching = await seedUpload("dispatching", NOW - 100 * DAY);

    const env30 = { ...env, RETENTION_DAYS: "30" } as Env;
    await purgeDeliveredPayloads(env30, NOW);

    // None of OUR seeded uploads qualify (recent / non-completed), so all keep
    // their payloads regardless of what other suites may have left behind.
    expect(await payloadPresent(recentDelivered)).toBe(true);
    expect(await payloadPresent(oldHalted)).toBe(true);
    expect(await payloadPresent(oldDispatching)).toBe(true);
    for (const id of [recentDelivered, oldHalted, oldDispatching]) {
      const upload = await env.DB.prepare("SELECT payload_purged_at FROM uploads WHERE id = ?")
        .bind(id)
        .first<{ payload_purged_at: number | null }>();
      expect(upload?.payload_purged_at).toBeNull();
    }
  });

  it("defaults to 30 days when RETENTION_DAYS is unset", async () => {
    const oldDelivered = await seedUpload("completed", NOW - 40 * DAY);
    const justRecent = await seedUpload("completed", NOW - 10 * DAY);

    const noRetention = { ...env, RETENTION_DAYS: undefined } as Env;
    await purgeDeliveredPayloads(noRetention, NOW);

    // 40-day-old completed upload is past the 30-day default and gets purged;
    // the 10-day-old one stays.
    expect(await payloadPresent(oldDelivered)).toBe(false);
    expect(await payloadPresent(justRecent)).toBe(true);
  });
});

describe("purgeStaleRateLimits", () => {
  it("deletes rate-limit windows older than an hour, keeps recent ones", async () => {
    const HOUR = 60 * 60;
    const k = `test:${crypto.randomUUID()}`;
    const stale = NOW - HOUR - 120; // > 1h old
    const fresh = NOW - 60; // within the last hour
    await env.DB.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)")
      .bind(k, stale)
      .run();
    await env.DB.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)")
      .bind(k, fresh)
      .run();

    const deleted = await purgeStaleRateLimits(env, NOW);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const staleRow = await env.DB.prepare(
      "SELECT 1 FROM rate_limits WHERE key = ? AND window_start = ?",
    )
      .bind(k, stale)
      .first();
    const freshRow = await env.DB.prepare(
      "SELECT 1 FROM rate_limits WHERE key = ? AND window_start = ?",
    )
      .bind(k, fresh)
      .first();
    expect(staleRow).toBeNull();
    expect(freshRow).not.toBeNull();
  });
});
