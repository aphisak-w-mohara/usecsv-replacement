import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("dev session middleware", () => {
  it("attaches a synthetic session from DEV_USER_EMAIL to /api/* routes", async () => {
    const res = await SELF.fetch("https://example.com/api/whoami");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      user: {
        id: "usr_dev",
        email: "aphisak@mohara.co",
      },
      project_id: "proj_evo",
      role: "owner",
    });
  });

  it("does NOT interfere with the open /api/health route", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
