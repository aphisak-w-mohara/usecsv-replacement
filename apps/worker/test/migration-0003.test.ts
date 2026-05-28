import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

describe("migration 0003 — dispatch schema", () => {
  beforeAll(async () => {
    // Seed minimal parent rows so FK constraints on upload_batches / webhook_attempts pass.
    // The uploads table has many NOT NULL fields; we supply the minimum required values.
    const seeds: Array<[string, number]> = [
      ["upl_mig_a", 9001],
      ["upl_mig_b", 9002],
    ];
    for (const [id, numericId] of seeds) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO uploads
           (id, numeric_id, project_id, importer_environment_id,
            file_name, file_size, r2_source_key,
            matched_columns_map, uploaded_file_headers,
            total_rows, batch_size, batch_count, status,
            created_at, updated_at)
         VALUES (?, ?, 'proj_evo', 'impenv_tenants_staging',
                 'test.csv', 0, 'uploads/' || ? || '/source.csv',
                 '{}', '[]',
                 1, 1000, 1, 'pending',
                 1, 1)`,
      )
        .bind(id, numericId, id)
        .run();
    }
  });

  it("uploads has an idempotency_key column", async () => {
    const cols = await env.DB.prepare("PRAGMA table_info(uploads)").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toContain("idempotency_key");
  });

  it("upload_batches table accepts a row", async () => {
    await env.DB.prepare(
      `INSERT INTO upload_batches (upload_id, batch_index, r2_key, row_count, created_at)
       VALUES ('upl_mig_a', 1, 'uploads/upl_mig_a/batches/1.json', 3, 1)`,
    ).run();
    const row = await env.DB.prepare(
      "SELECT row_count FROM upload_batches WHERE upload_id = 'upl_mig_a' AND batch_index = 1",
    ).first<{ row_count: number }>();
    expect(row?.row_count).toBe(3);
  });

  it("webhook_attempts table accepts a row and enforces the unique triple", async () => {
    await env.DB.prepare(
      `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, started_at)
       VALUES ('wha_mig_1', 'upl_mig_b', 1, 1, 200, 1)`,
    ).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO webhook_attempts (id, upload_id, batch_index, attempt_number, status_code, started_at)
         VALUES ('wha_mig_2', 'upl_mig_b', 1, 1, 500, 2)`,
      ).run(),
    ).rejects.toThrow();
  });
});
