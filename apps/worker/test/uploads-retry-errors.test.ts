import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const UPLOAD_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "t.csv",
  file_size: 64,
  matched_columns_map: { first_name: "First name", email: "Customer Email" },
  uploaded_file_headers: ["First name", "Customer Email"],
  total_rows: 2,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

async function seed(): Promise<string> {
  const created = await (
    await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(UPLOAD_BODY),
    })
  ).json();
  await SELF.fetch(`https://example.com/api/uploads/${created.upload_id}/batches/1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows: [
        { row: 1, first_name: "Alice", email: "alice@example.com" },
        { row: 2, first_name: "Bob", email: "bob@example.com" },
      ],
    }),
  });
  return created.upload_id;
}

describe("POST /api/uploads/:id/retry", () => {
  it("re-enqueues the unfinished batch and resets status to dispatching", async () => {
    const id = await seed();
    await env.DB.prepare("UPDATE uploads SET status = 'halted' WHERE id = ?").bind(id).run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/retry`, { method: "POST" });
    expect(res.status).toBe(202);

    const upload = await env.DB.prepare("SELECT status FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ status: string }>();
    expect(upload?.status).toBe("dispatching");
  });

  it("404s when the upload is not in the active project", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads/upl_nope/retry", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/uploads/:id/errors.csv", () => {
  it("streams a CSV of row errors joined with the original row data", async () => {
    const id = await seed();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO webhook_attempts
        (id, upload_id, batch_index, attempt_number, status_code, errors_json, started_at, finished_at)
       VALUES (?, ?, 1, 1, 200, '[{"row":2,"msg":"duplicate email"}]', ?, ?)`,
    )
      .bind(`wha_${crypto.randomUUID()}`, id, now, now)
      .run();

    const res = await SELF.fetch(`https://example.com/api/uploads/${id}/errors.csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.trim().split("\n");
    // header + 1 error row
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("row");
    expect(lines[0]).toContain("error_message");
    expect(lines[1]).toContain("Bob"); // row 2's first_name
    expect(lines[1]).toContain("duplicate email");
  });
});
