import { SELF } from "cloudflare:test";
import type { Env } from "../../src/env.js";
import { SESSION_TTL_SECONDS } from "../../src/lib/session.js";

const DEFAULT_TOKEN = "test-session";

export type SeedSessionOpts = {
  token?: string;
  userId?: string;
  projectId?: string;
  environmentId?: string;
  role?: "owner" | "member";
};

/**
 * Write a `session:<token>` KV row directly so authed requests have a real,
 * KV-backed session — the ONLY test seam into the auth gate (no dev backdoor).
 * Defaults to the 0001 seed owner. Returns the matching Cookie header value.
 */
export async function seedSession(env: Env, opts: SeedSessionOpts = {}): Promise<string> {
  const token = opts.token ?? DEFAULT_TOKEN;
  const row = {
    user_id: opts.userId ?? "usr_dev",
    project_id: opts.projectId ?? "proj_evo",
    environment_id: opts.environmentId ?? "env_evo_staging",
    role: opts.role ?? "owner",
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  await env.SESSIONS.put(`session:${token}`, JSON.stringify(row), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  // Local-dev cookie name (ENVIRONMENT="local" in the test vars).
  return `evocsv-session=${token}`;
}

/**
 * `SELF.fetch` wrapper that merges the session cookie into the request headers.
 * Defaults to the seeded owner's token.
 */
export function authedFetch(
  path: string,
  init: RequestInit = {},
  token = DEFAULT_TOKEN,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `evocsv-session=${token}`);
  return SELF.fetch(path, { ...init, headers });
}
