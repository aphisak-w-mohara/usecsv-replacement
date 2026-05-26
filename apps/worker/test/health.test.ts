import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("GET /api/health", () => {
  it("returns ok: true", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
