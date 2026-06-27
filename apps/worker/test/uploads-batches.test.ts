import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { gunzipToString } from "../src/lib/gzip.js";
import { authedFetch } from "./helpers/auth.js";

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "sample-tenants.csv",
  file_size: 256,
  matched_columns_map: {
    first_name: "First name",
    last_name: "Last name",
    email: "Customer Email",
  },
  uploaded_file_headers: ["First name", "Last name", "Customer Email", "Notes"],
  total_rows: 3,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

async function createUpload(): Promise<{ upload_id: string; numeric_id: number }> {
  const res = await authedFetch("https://example.com/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(UPLOAD_BODY),
  });
  return res.json<{ upload_id: string; numeric_id: number }>();
}

describe("POST /api/uploads/:id/batches/:index", () => {
  it("writes the canonical payload (gzipped) into upload_batches, returns 204", async () => {
    const { upload_id, numeric_id } = await createUpload();

    const res = await authedFetch(`https://example.com/api/uploads/${upload_id}/batches/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [
          { row: 1, first_name: "Alice", last_name: "Smith", email: "alice@example.com" },
          { row: 2, first_name: "Bob", last_name: "Jones", email: "bob@example.com" },
          { row: 3, first_name: "Carol", last_name: "Lee", email: "carol.lee@example.com" },
        ],
      }),
    });
    expect(res.status).toBe(204);

    const batchRow = await env.DB.prepare(
      "SELECT payload, payload_encoding, row_count FROM upload_batches WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(upload_id)
      .first<{ payload: ArrayBuffer; payload_encoding: string; row_count: number }>();
    expect(batchRow?.row_count).toBe(3);
    expect(batchRow?.payload_encoding).toBe("gzip");

    const payload = JSON.parse(await gunzipToString(batchRow!.payload));
    expect(payload.uploadId).toBe(numeric_id);
    expect(payload.importerId).toBe("82b18e5e-6412-4102-901a-ce3c05d71460");
    expect(payload.batch).toEqual({ index: 1, count: 1, totalRows: 3 });
    expect(payload.rows[0]).toEqual({
      row: 1,
      first_name: "Alice",
      last_name: "Smith",
      email: "alice@example.com",
    });

    const statusRow = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(upload_id)
      .first<{ status: string }>();
    expect(statusRow?.status).toBe("dispatching");
  });

  it("is idempotent on (upload_id, batch_index) — repeat returns 204, no duplicate row", async () => {
    const { upload_id } = await createUpload();
    const body = JSON.stringify({
      rows: [{ row: 1, first_name: "A", last_name: "B", email: "a@b.com" }],
    });
    const opts = { method: "POST", headers: { "Content-Type": "application/json" }, body };

    const first = await authedFetch(`https://example.com/api/uploads/${upload_id}/batches/1`, opts);
    const second = await authedFetch(
      `https://example.com/api/uploads/${upload_id}/batches/1`,
      opts,
    );
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM upload_batches WHERE upload_id = ?",
    )
      .bind(upload_id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("404s for an upload in another project / nonexistent", async () => {
    const res = await authedFetch("https://example.com/api/uploads/upl_nope/batches/1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [{ row: 1, first_name: "A", last_name: "B", email: "a@b.com" }],
      }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a batch with more than 5,000 rows with 400 (#77)", async () => {
    const { upload_id } = await createUpload();
    const rows = Array.from({ length: 5_001 }, (_, i) => ({
      row: i + 1,
      first_name: "A",
      last_name: "B",
      email: "a@b.com",
    }));
    const res = await authedFetch(`https://example.com/api/uploads/${upload_id}/batches/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a batch carrying more rows than the upload's declared batch_size with 400 (#77 review)", async () => {
    // Upload declares batch_size=2 (total_rows=3 → batch_count=2); a batch with
    // 3 rows contradicts that accounting.
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...UPLOAD_BODY, total_rows: 3, batch_size: 2, batch_count: 2 }),
    });
    const { upload_id } = await res.json<{ upload_id: string }>();

    const batchRes = await authedFetch(`https://example.com/api/uploads/${upload_id}/batches/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: [
          { row: 1, first_name: "A", last_name: "B", email: "a@b.com" },
          { row: 2, first_name: "C", last_name: "D", email: "c@d.com" },
          { row: 3, first_name: "E", last_name: "F", email: "e@f.com" },
        ],
      }),
    });
    expect(batchRes.status).toBe(400);
  });

  it("rejects a batch whose serialized payload exceeds 25 MB with 413 (#77)", async () => {
    const { upload_id } = await createUpload();
    // Stay under the 5,000-row count cap but blow past the 25 MB byte cap by
    // packing a large string into each row (~10 KB × 3,000 rows ≈ 30 MB).
    const big = "x".repeat(10 * 1024);
    const rows = Array.from({ length: 3_000 }, (_, i) => ({
      row: i + 1,
      first_name: big,
      last_name: "B",
      email: "a@b.com",
    }));
    const res = await authedFetch(`https://example.com/api/uploads/${upload_id}/batches/1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    expect(res.status).toBe(413);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/too large/i);
  });
});
