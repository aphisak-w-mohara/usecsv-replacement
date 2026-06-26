import { SELF, env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** base64url-encode a UTF-8 string (no padding). */
function b64url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build a fake Google id_token = base64url(header).base64url(payload).sig.
 * Signature is irrelevant — the worker doesn't verify it (token comes straight
 * from Google's token endpoint over TLS); it only asserts aud + iss.
 */
function fakeIdToken(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

/** Intercept Google's token endpoint and return the given id_token once. */
function mockTokenEndpoint(idToken: string) {
  fetchMock
    .get("https://oauth2.googleapis.com")
    .intercept({ path: "/token", method: "POST" })
    .reply(200, {
      id_token: idToken,
      access_token: "fake-access",
      token_type: "Bearer",
      expires_in: 3600,
    });
}

/** Start the login leg and pull the `state` out of the 302 Location. */
async function startLoginAndGetState(): Promise<string> {
  const res = await SELF.fetch("https://example.com/api/auth/google/login", {
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toBeTruthy();
  const url = new URL(location!);
  const state = url.searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}

beforeAll(() => {
  fetchMock.activate();
});

beforeEach(() => {
  fetchMock.activate();
  // Only requests we explicitly intercept should be allowed out.
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("GET /api/auth/google/login", () => {
  it("302s to Google with PKCE + state", async () => {
    const res = await SELF.fetch("https://example.com/api/auth/google/login", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location")!);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });
});

describe("GET /api/auth/google/callback — closed-signup gate", () => {
  it("(a) binds google_sub for the seeded owner (email match, null sub) and sets a cookie", async () => {
    const state = await startLoginAndGetState();
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-owner-123",
        email: "aphisak@mohara.co",
        email_verified: true,
        name: "Aphisak Naksomboon",
      }),
    );

    const res = await SELF.fetch(
      `https://example.com/api/auth/google/callback?code=fake&state=${state}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/importers");
    expect(res.headers.get("Set-Cookie")).toMatch(/evocsv-session=/);

    const row = await env.DB.prepare("SELECT google_sub FROM users WHERE id = 'usr_dev'").first<{
      google_sub: string;
    }>();
    expect(row?.google_sub).toBe("google-sub-owner-123");
  });

  it("(b) signs in again via the now-bound google_sub (branch 1)", async () => {
    const state = await startLoginAndGetState();
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-owner-123",
        email: "aphisak@mohara.co",
        email_verified: true,
        name: "Aphisak Naksomboon",
      }),
    );

    const res = await SELF.fetch(
      `https://example.com/api/auth/google/callback?code=fake&state=${state}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toMatch(/evocsv-session=/);
  });

  it("(c) rejects an unknown email with 403 and creates no user row", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();

    const state = await startLoginAndGetState();
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-stranger-999",
        email: "stranger@example.com",
        email_verified: true,
        name: "A Stranger",
      }),
    );

    const res = await SELF.fetch(
      `https://example.com/api/auth/google/callback?code=fake&state=${state}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();

    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("(d) 400s on a missing/bad state (no token exchange happens)", async () => {
    // No interceptor registered: if the worker tried to exchange the code, the
    // disabled net-connect would throw. A clean 400 proves it short-circuits.
    const res = await SELF.fetch(
      "https://example.com/api/auth/google/callback?code=fake&state=does-not-exist",
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
  });
});

describe("safeReturnTo (open-redirect guard)", () => {
  it("passes through local absolute paths", async () => {
    const { safeReturnTo } = await import("../src/routes/auth.js");
    expect(safeReturnTo("/admin/importers/imp_x/upload")).toBe("/admin/importers/imp_x/upload");
  });

  it("rejects absolute URLs, protocol-relative, and backslash tricks → default", async () => {
    const { safeReturnTo } = await import("../src/routes/auth.js");
    expect(safeReturnTo("https://evil.com")).toBe("/admin/importers");
    expect(safeReturnTo("//evil.com")).toBe("/admin/importers");
    expect(safeReturnTo("/\\evil.com")).toBe("/admin/importers");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/admin/importers");
    expect(safeReturnTo(null)).toBe("/admin/importers");
  });
});
