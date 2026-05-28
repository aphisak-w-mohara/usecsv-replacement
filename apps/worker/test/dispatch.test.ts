import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatchBatch } from "../src/lib/dispatch";

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

async function seedUploadWithBatch(): Promise<string> {
  const created = await (
    await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(UPLOAD_BODY),
    })
  ).json<{ upload_id: string }>();
  await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [{ row: 1, first_name: "Alice" }] }),
  });
  return created.upload_id;
}

describe("dispatchBatch", () => {
  it("on 2xx with empty errors: records attempt, marks upload completed", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = async () =>
      new Response(JSON.stringify({ errors: [] }), { status: 200 });

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch as typeof fetch);

    const attempt = await env.DB.prepare(
      "SELECT status_code, errors_json FROM webhook_attempts WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(id)
      .first<{ status_code: number; errors_json: string | null }>();
    expect(attempt?.status_code).toBe(200);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("completed");
  });

  it("on 2xx with row errors: stores errors_json, still completes", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = async () =>
      new Response(JSON.stringify({ errors: [{ row: 1, msg: "bad" }] }), { status: 200 });

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 1 }, fakeFetch as typeof fetch);

    const attempt = await env.DB.prepare(
      "SELECT errors_json FROM webhook_attempts WHERE upload_id = ? AND batch_index = 1",
    )
      .bind(id)
      .first<{ errors_json: string }>();
    expect(JSON.parse(attempt!.errors_json)).toEqual([{ row: 1, msg: "bad" }]);
    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("completed");
  });

  it("on 5xx at the final attempt (6): marks upload halted", async () => {
    const id = await seedUploadWithBatch();
    const fakeFetch = async () => new Response("upstream boom", { status: 500 });

    await dispatchBatch(env, { uploadId: id, batchIndex: 1, attempt: 6 }, fakeFetch as typeof fetch);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("halted");
    const attempt = await env.DB.prepare(
      "SELECT status_code, response_body FROM webhook_attempts WHERE upload_id = ? AND attempt_number = 6",
    )
      .bind(id)
      .first<{ status_code: number; response_body: string }>();
    expect(attempt?.status_code).toBe(500);
    expect(attempt?.response_body).toContain("boom");
  });
});
