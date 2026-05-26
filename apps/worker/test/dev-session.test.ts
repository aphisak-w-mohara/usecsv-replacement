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

  it("open /api/health route bypasses middleware due to registration order", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // NOTE: A negative test for the DEV_USER_EMAIL="" branch is not feasible with
  // @cloudflare/vitest-pool-workers v0.5.41. The `cloudflare:test` module exposes
  // `env` as a read-only object with no per-test override API (no OVERRIDE(),
  // withEnv(), or similar). Worker bindings and vars are fixed at pool
  // initialisation time and cannot be mutated between individual test cases.
  // TODO: Add this test when the pool-workers package gains a per-test env
  //       override mechanism, or when the middleware is restructured to accept
  //       the env as a parameter (making it unit-testable without SELF.fetch).
});
