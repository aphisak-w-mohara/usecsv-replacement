import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedFetch, seedSession } from "./helpers/auth.js";

beforeAll(() => seedSession(env));

const VALID_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "tenants.csv",
  file_size: 1024,
  matched_columns_map: { first_name: "First name" },
  uploaded_file_headers: ["First name"],
  total_rows: 3,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

describe("POST /api/uploads (Story #2 — context form ingest)", () => {
  it("returns upload_id, numeric_id, and status=pending on a valid call", async () => {
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ upload_id: string; numeric_id: number; status: string }>();
    expect(body).toMatchObject({
      upload_id: expect.stringMatching(/^upl_/),
      numeric_id: expect.any(Number),
      status: "pending",
    });
  });

  it("auto-fills user_payload with session email when null", async () => {
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ upload_id: string }>();
    const upload = await env.DB.prepare("SELECT user_payload FROM uploads WHERE id = ?")
      .bind(body.upload_id)
      .first<{ user_payload: string }>();
    expect(JSON.parse(upload!.user_payload)).toEqual({ userId: "aphisak@mohara.co" });
  });

  it("preserves user_payload.userId when caller supplies one", async () => {
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_BODY,
        user_payload: { userId: "external-id", role: "ops" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ upload_id: string }>();
    const upload = await env.DB.prepare("SELECT user_payload FROM uploads WHERE id = ?")
      .bind(body.upload_id)
      .first<{ user_payload: string }>();
    expect(JSON.parse(upload!.user_payload)).toEqual({
      userId: "external-id",
      role: "ops",
    });
  });

  it("stores metadata_payload as-is when non-null", async () => {
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_BODY,
        metadata_payload: { ticket_reference: "EVO-1234", note: "test" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ upload_id: string }>();
    const upload = await env.DB.prepare("SELECT metadata_payload FROM uploads WHERE id = ?")
      .bind(body.upload_id)
      .first<{ metadata_payload: string }>();
    expect(JSON.parse(upload!.metadata_payload)).toEqual({
      ticket_reference: "EVO-1234",
      note: "test",
    });
  });

  it("rejects an invalid importer_environment_id with 404", async () => {
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, importer_environment_id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects oversized user_payload (>4KB) with 400", async () => {
    const giant = { padding: "x".repeat(5000) };
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, user_payload: giant }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/too large/i);
  });

  it("rejects oversized metadata_payload (>4KB) with 400", async () => {
    const giant = { padding: "x".repeat(5000) };
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, metadata_payload: giant }),
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ error: string }>();
    expect(body.error).toMatch(/too large/i);
  });

  it("accepts user_payload of exactly 4096 bytes (boundary)", async () => {
    // JSON.stringify of {"padding": "<3987 x's>"} is ~4000 bytes; we need to land
    // exactly at 4096. Start with the padding key and add x's until at-or-just-under.
    const overhead = JSON.stringify({ padding: "" }).length; // 14
    const exactly4096 = { padding: "x".repeat(4096 - overhead) };
    // Sanity check (will throw in test if off-by-one):
    const size = new TextEncoder().encode(JSON.stringify(exactly4096)).byteLength;
    expect(size).toBe(4096);

    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, user_payload: exactly4096 }),
    });
    // Guard is strict `>`, so exactly 4096 should still PASS
    expect(res.status).toBe(201);
  });

  it("rejects total_rows = 0 (zod schema enforcement)", async () => {
    const res = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, total_rows: 0 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/uploads — idempotency", () => {
  it("returns the same upload row for a repeated Idempotency-Key, creating no duplicate", async () => {
    const key = `idem-${crypto.randomUUID()}`;
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key };

    const first = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_BODY),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json<{ upload_id: string; numeric_id: number }>();

    const second = await authedFetch("https://example.com/api/uploads", {
      method: "POST",
      headers,
      body: JSON.stringify(VALID_BODY),
    });
    // Idempotent replay returns 200 with the SAME upload, never a new 201.
    expect(second.status).toBe(200);
    const secondBody = await second.json<{ upload_id: string; numeric_id: number }>();
    expect(secondBody.upload_id).toBe(firstBody.upload_id);
    expect(secondBody.numeric_id).toBe(firstBody.numeric_id);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM uploads WHERE idempotency_key = ?",
    )
      .bind(key)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

describe("POST /api/uploads — archived importer guard", () => {
  it("returns 404 when the importer behind the env is archived", async () => {
    // Archive the seeded Tenants importer (used by impenv_tenants_staging).
    await env.DB.prepare(
      "UPDATE importers SET archived_at = unixepoch() WHERE id = 'imp_tenants'",
    ).run();

    try {
      const res = await authedFetch("https://example.com/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_BODY),
      });
      expect(res.status).toBe(404);
    } finally {
      // Restore for downstream tests
      await env.DB.prepare(
        "UPDATE importers SET archived_at = NULL WHERE id = 'imp_tenants'",
      ).run();
    }
  });
});
