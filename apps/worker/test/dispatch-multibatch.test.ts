import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatchBatch } from "../src/lib/dispatch";
import { gunzipToString } from "../src/lib/gzip";

// Epic #44 success criterion #5: a multi-batch upload exercised through the
// dispatch consumer asserts batch.index ordering and the index === count
// invariant on the final batch (Laravel's TenantsImport final-batch logic).

const BATCH_COUNT = 3;

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "sample-tenants.csv",
  file_size: 256,
  matched_columns_map: { first_name: "First name" },
  uploaded_file_headers: ["First name"],
  total_rows: BATCH_COUNT,
  batch_size: 1,
  batch_count: BATCH_COUNT,
  user_payload: null,
  metadata_payload: null,
};

async function seedMultiBatchUpload(): Promise<string> {
  const created = await (
    await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(UPLOAD_BODY),
    })
  ).json<{ upload_id: string }>();

  for (let i = 1; i <= BATCH_COUNT; i++) {
    await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/${i}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [{ row: i, first_name: `Row${i}` }] }),
    });
  }
  return created.upload_id;
}

describe("multi-batch dispatch (E2E ordering)", () => {
  it("delivers batches 1..N in order, final batch satisfies index === count, upload completes", async () => {
    const id = await seedMultiBatchUpload();

    // Each persisted batch payload pins its own index/count — verify the contract.
    // Payloads live gzipped inline in D1 (upload_batches.payload), not R2 (ADR-0002).
    for (let i = 1; i <= BATCH_COUNT; i++) {
      const row = await env.DB.prepare(
        "SELECT payload FROM upload_batches WHERE upload_id = ? AND batch_index = ?",
      )
        .bind(id, i)
        .first<{ payload: ArrayBuffer }>();
      expect(row?.payload).toBeTruthy();
      const payload = JSON.parse(await gunzipToString(row!.payload));
      expect(payload.batch).toEqual({ index: i, count: BATCH_COUNT, totalRows: BATCH_COUNT });
    }

    // Drive each batch through the consumer's unit of work, recording the order
    // Laravel actually receives them in (parsed from the signed/raw body).
    const received: Array<{ index: number; count: number }> = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { batch: { index: number; count: number } };
      received.push(body.batch);
      return new Response(JSON.stringify({ errors: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    for (let i = 1; i <= BATCH_COUNT; i++) {
      await dispatchBatch(env, { uploadId: id, batchIndex: i, attempt: 1 }, fakeFetch);
    }

    expect(received.map((b) => b.index)).toEqual([1, 2, 3]);
    // Final-batch invariant Laravel depends on.
    const last = received[received.length - 1]!;
    expect(last.index).toBe(last.count);

    // Every batch recorded a 2xx attempt → upload completed.
    const delivered = await env.DB.prepare(
      "SELECT COUNT(DISTINCT batch_index) AS n FROM webhook_attempts WHERE upload_id = ? AND status_code >= 200 AND status_code < 300",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(delivered?.n).toBe(BATCH_COUNT);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("completed");
  });

  it("does not complete while an interior batch is undelivered", async () => {
    const id = await seedMultiBatchUpload();
    const ok = (async () =>
      new Response(JSON.stringify({ errors: [] }), { status: 200 })) as unknown as typeof fetch;

    // Deliver 1 and 3, skip 2.
    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, ok);
    await dispatchBatch(env, { uploadId: id, batchIndex: 3, attempt: 1 }, ok);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("dispatching");
  });
});
