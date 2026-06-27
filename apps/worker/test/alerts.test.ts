import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { alertHaltedUploads } from "../src/lib/alerts";
import { authedFetch } from "./helpers/auth.js";

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

/** Create an upload, persist batch 1, then force it into status='halted'. */
async function seedHaltedUpload(): Promise<string> {
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
  await env.DB.prepare("UPDATE uploads SET status = 'halted', halt_alerted_at = NULL WHERE id = ?")
    .bind(created.upload_id)
    .run();
  return created.upload_id;
}

// Worker tests share storage (isolatedStorage: false), so other suites may leave
// halted uploads around. Assert against THIS test's seeded upload, not a global
// count, and only count POSTs that targeted our upload's webhook payload.
describe("alertHaltedUploads", () => {
  it("alerts a halted upload once and stamps halt_alerted_at", async () => {
    const id = await seedHaltedUpload();
    const postedFor: string[] = [];
    const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes(id)) postedFor.push(id);
      return new Response("ok", { status: 200 });
    });

    const withWebhook = { ...env, ALERT_WEBHOOK_URL: "https://hooks.example/slack" } as Env;
    await alertHaltedUploads(withWebhook, fakeFetch as unknown as typeof fetch);

    expect(postedFor).toEqual([id]); // exactly one POST for our upload
    const row = await env.DB.prepare("SELECT halt_alerted_at FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ halt_alerted_at: number | null }>();
    expect(row?.halt_alerted_at).toBeTypeOf("number");
  });

  it("does not re-alert once halt_alerted_at is set", async () => {
    const id = await seedHaltedUpload();
    await env.DB.prepare("UPDATE uploads SET halt_alerted_at = 123 WHERE id = ?").bind(id).run();
    let postedForOurs = false;
    const fakeFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (String(init?.body ?? "").includes(id)) postedForOurs = true;
      return new Response("ok", { status: 200 });
    });

    const withWebhook = { ...env, ALERT_WEBHOOK_URL: "https://hooks.example/slack" } as Env;
    await alertHaltedUploads(withWebhook, fakeFetch as unknown as typeof fetch);

    // Already alerted: no POST for our upload, and the timestamp is unchanged.
    expect(postedForOurs).toBe(false);
    const row = await env.DB.prepare("SELECT halt_alerted_at FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ halt_alerted_at: number }>();
    expect(row?.halt_alerted_at).toBe(123); // unchanged
  });

  it("does not throw and leaves the upload un-stamped when ALERT_WEBHOOK_URL is unset", async () => {
    const id = await seedHaltedUpload();
    const fakeFetch = vi.fn(async () => new Response("ok", { status: 200 }));

    const noWebhook = { ...env, ALERT_WEBHOOK_URL: undefined } as Env;
    // Must not throw with the webhook unset.
    await expect(alertHaltedUploads(noWebhook, fakeFetch as unknown as typeof fetch)).resolves.toBe(
      0,
    );

    expect(fakeFetch).not.toHaveBeenCalled(); // no network when unset
    const row = await env.DB.prepare("SELECT halt_alerted_at FROM uploads WHERE id = ?")
      .bind(id)
      .first<{ halt_alerted_at: number | null }>();
    // Left un-stamped so the alert is delivered once a webhook is configured.
    expect(row?.halt_alerted_at).toBeNull();
  });
});
