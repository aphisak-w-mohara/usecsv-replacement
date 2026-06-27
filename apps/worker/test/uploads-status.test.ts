import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authedFetch } from "./helpers/auth.js";

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "t.csv",
  file_size: 64,
  matched_columns_map: { first_name: "First name" },
  uploaded_file_headers: ["First name"],
  total_rows: 3,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

async function createUpload(): Promise<string> {
  const res = await authedFetch("https://example.com/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(UPLOAD_BODY),
  });
  return (await res.json<{ upload_id: string }>()).upload_id;
}

type StatusBody = {
  upload_id: string;
  status: string;
  batch_count: number;
  batches_delivered: number;
  has_row_errors: boolean;
  latest_attempt: { batch_index: number; attempt_number: number; status_code: number } | null;
  row_errors: Array<{ row: number; msg: string }>;
};

describe("GET /api/uploads/:id", () => {
  it("reports pending with zero delivered when no attempts exist", async () => {
    const id = await createUpload();
    const res = await authedFetch(`https://example.com/api/uploads/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json<StatusBody>();
    expect(body).toMatchObject({
      upload_id: id,
      status: "pending",
      batch_count: 1,
      batches_delivered: 0,
      has_row_errors: false,
    });
    expect(body.latest_attempt).toBeNull();
    expect(body.row_errors).toEqual([]);
  });

  it("counts delivered batches and surfaces row errors from errors_json", async () => {
    const id = await createUpload();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO webhook_attempts
        (id, upload_id, batch_index, attempt_number, status_code, response_body, errors_json, started_at, finished_at)
       VALUES (?, ?, 1, 1, 200, '{"errors":[{"row":2,"msg":"duplicate email"}]}',
               '[{"row":2,"msg":"duplicate email"}]', ?, ?)`,
    )
      .bind(`wha_${crypto.randomUUID()}`, id, now, now)
      .run();
    await env.DB.prepare("UPDATE uploads SET status = 'completed' WHERE id = ?").bind(id).run();

    const res = await authedFetch(`https://example.com/api/uploads/${id}`);
    const body = await res.json<StatusBody>();
    expect(body.status).toBe("completed");
    expect(body.batches_delivered).toBe(1);
    expect(body.has_row_errors).toBe(true);
    expect(body.row_errors).toEqual([{ row: 2, msg: "duplicate email" }]);
    expect(body.latest_attempt).toMatchObject({
      batch_index: 1,
      attempt_number: 1,
      status_code: 200,
    });
  });

  it("404s for an upload outside the active project", async () => {
    const res = await authedFetch("https://example.com/api/uploads/upl_nope");
    expect(res.status).toBe(404);
  });
});
