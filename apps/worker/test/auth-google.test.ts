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
async function startLoginAndGetState(query = ""): Promise<string> {
  const res = await SELF.fetch(`https://example.com/api/auth/google/login${query}`, {
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

describe("GET /api/auth/google/callback — invite acceptance (branch 3)", () => {
  it("materializes a user + membership and marks accepted_at for a matching pending invite", async () => {
    const now = Math.floor(Date.now() / 1000);
    const inviteToken = "invite-token-junior";
    await env.DB.prepare(
      `INSERT INTO invites
         (id, project_id, email, role, token, invited_by, created_at, expires_at)
       VALUES (?, 'proj_evo', 'junior@mohara.co', 'member', ?, 'usr_dev', ?, ?)`,
    )
      .bind("inv_junior", inviteToken, now, now + 7 * 24 * 60 * 60)
      .run();

    const state = await startLoginAndGetState(
      `?invite_token=${inviteToken}&return_to=/admin/importers`,
    );
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-junior-555",
        email: "junior@mohara.co",
        email_verified: true,
        name: "Junior Dev",
      }),
    );

    const res = await SELF.fetch(
      `https://example.com/api/auth/google/callback?code=fake&state=${state}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/importers");
    expect(res.headers.get("Set-Cookie")).toMatch(/evocsv-session=/);

    // A users row was created for junior, bound to the google_sub.
    const user = await env.DB.prepare(
      "SELECT id, google_sub FROM users WHERE email = 'junior@mohara.co'",
    ).first<{ id: string; google_sub: string }>();
    expect(user?.google_sub).toBe("google-sub-junior-555");

    // A membership at the invited role exists.
    const membership = await env.DB.prepare(
      "SELECT role FROM memberships WHERE project_id = 'proj_evo' AND user_id = ?",
    )
      .bind(user!.id)
      .first<{ role: string }>();
    expect(membership?.role).toBe("member");

    // The invite is now accepted.
    const invite = await env.DB.prepare(
      "SELECT accepted_at FROM invites WHERE id = 'inv_junior'",
    ).first<{ accepted_at: number | null }>();
    expect(invite?.accepted_at).not.toBeNull();
  });

  it("rejects (403) when the Google email does not match the invite email; creates no rows", async () => {
    const now = Math.floor(Date.now() / 1000);
    const inviteToken = "invite-token-mismatch";
    await env.DB.prepare(
      `INSERT INTO invites
         (id, project_id, email, role, token, invited_by, created_at, expires_at)
       VALUES (?, 'proj_evo', 'invited@mohara.co', 'member', ?, 'usr_dev', ?, ?)`,
    )
      .bind("inv_mismatch", inviteToken, now, now + 7 * 24 * 60 * 60)
      .run();

    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE email = 'wrongperson@example.com'",
    ).first<{ n: number }>();

    const state = await startLoginAndGetState(`?invite_token=${inviteToken}`);
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-wrongperson",
        email: "wrongperson@example.com",
        email_verified: true,
        name: "Wrong Person",
      }),
    );

    const res = await SELF.fetch(
      `https://example.com/api/auth/google/callback?code=fake&state=${state}`,
      { redirect: "manual" },
    );
    // Email isn't a member, isn't bound, and the invite token doesn't match this
    // email → falls through to the closed-signup 403.
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE email = 'wrongperson@example.com'",
    ).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);

    // Invite remains pending.
    const invite = await env.DB.prepare(
      "SELECT accepted_at FROM invites WHERE id = 'inv_mismatch'",
    ).first<{ accepted_at: number | null }>();
    expect(invite?.accepted_at).toBeNull();
  });
});

describe("GET /api/auth/google/callback — allowed_email_domain enforcement (Story 5)", () => {
  // The restriction is shared D1 state; clear it after each test in this block.
  afterEach(async () => {
    await env.DB.prepare(
      "UPDATE projects SET allowed_email_domain = NULL WHERE id = 'proj_evo'",
    ).run();
  });

  async function setDomain(domain: string | null) {
    await env.DB.prepare(
      "UPDATE projects SET allowed_email_domain = ? WHERE id = 'proj_evo'",
    )
      .bind(domain)
      .run();
  }

  it("login redirect includes the hd hint when a domain is set", async () => {
    await setDomain("mohara.co");
    const res = await SELF.fetch("https://example.com/api/auth/google/login", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("Location")!);
    expect(url.searchParams.get("hd")).toBe("mohara.co");
  });

  it("rejects a Workspace token whose hd mismatches → 403, no user row", async () => {
    await setDomain("mohara.co");
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE email = 'elsewhere@otherco.com'",
    ).first<{ n: number }>();

    const state = await startLoginAndGetState();
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-otherco",
        email: "elsewhere@otherco.com",
        email_verified: true,
        hd: "otherco.com",
        name: "Else Where",
      }),
    );

    const res = await SELF.fetch(
      `https://example.com/api/auth/google/callback?code=fake&state=${state}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();

    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE email = 'elsewhere@otherco.com'",
    ).first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("rejects a personal (gmail) token with no hd claim → 403, no user row", async () => {
    await setDomain("mohara.co");
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{
      n: number;
    }>();

    const state = await startLoginAndGetState();
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-gmail-person",
        email: "person@gmail.com",
        email_verified: true,
        // no hd claim — personal account
        name: "Gmail Person",
      }),
    );

    const res = await SELF.fetch(
      `https://example.com/api/auth/google/callback?code=fake&state=${state}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(403);

    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{
      n: number;
    }>();
    expect(after?.n).toBe(before?.n);
  });

  it("succeeds when hd and email domain both match the restriction", async () => {
    await setDomain("mohara.co");
    const state = await startLoginAndGetState();
    mockTokenEndpoint(
      fakeIdToken({
        aud: env.GOOGLE_CLIENT_ID,
        iss: "https://accounts.google.com",
        sub: "google-sub-owner-123", // seeded owner's bound sub (branch 1)
        email: "aphisak@mohara.co",
        email_verified: true,
        hd: "mohara.co",
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
