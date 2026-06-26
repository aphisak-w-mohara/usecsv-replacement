import type { Env } from "../env.js";
import { randomToken } from "./encoding.js";

/** 14 days in seconds — the rolling session window. */
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60; // 1209600
/** 10 minutes in seconds — the OAuth PKCE/state window. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 600

/** The stored shape behind `session:<token>`. */
export type SessionRow = {
  user_id: string;
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
  expires_at: number;
};

/** The stored shape behind `oauthstate:<state>`. */
export type OAuthStateRow = {
  verifier: string;
  return_to: string | null;
  invite_token: string | null;
};

function sessionKey(token: string): string {
  return `session:${token}`;
}

function oauthStateKey(state: string): string {
  return `oauthstate:${state}`;
}

export type CreateSessionInput = {
  userId: string;
  projectId: string;
  environmentId: string;
  role: "owner" | "member";
};

/** Mint an opaque session token and persist it in KV with a 14-day TTL. */
export async function createSession(env: Env, input: CreateSessionInput): Promise<string> {
  const token = randomToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const row: SessionRow = {
    user_id: input.userId,
    project_id: input.projectId,
    environment_id: input.environmentId,
    role: input.role,
    expires_at: expiresAt,
  };
  await env.SESSIONS.put(sessionKey(token), JSON.stringify(row), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

/**
 * Look up a session by token. On a hit, bump the KV TTL (re-put with a fresh
 * 14-day expiry) so the window rolls forward on every authenticated request.
 */
export async function getSession(env: Env, token: string): Promise<SessionRow | null> {
  const raw = await env.SESSIONS.get(sessionKey(token));
  if (!raw) return null;

  let row: SessionRow;
  try {
    row = JSON.parse(raw) as SessionRow;
  } catch {
    return null;
  }

  // Rolling window: rewrite the row with a fresh TTL + expires_at.
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const bumped: SessionRow = { ...row, expires_at: expiresAt };
  await env.SESSIONS.put(sessionKey(token), JSON.stringify(bumped), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return bumped;
}

/**
 * Patch fields on an existing session row in place (e.g. switching the active
 * environment) while preserving + bumping the rolling 14-day TTL. No-op if the
 * token has no row. Returns the updated row, or null on a miss.
 */
export async function updateSession(
  env: Env,
  token: string,
  patch: Partial<Pick<SessionRow, "project_id" | "environment_id" | "role">>,
): Promise<SessionRow | null> {
  const raw = await env.SESSIONS.get(sessionKey(token));
  if (!raw) return null;

  let row: SessionRow;
  try {
    row = JSON.parse(raw) as SessionRow;
  } catch {
    return null;
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const updated: SessionRow = { ...row, ...patch, expires_at: expiresAt };
  await env.SESSIONS.put(sessionKey(token), JSON.stringify(updated), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return updated;
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.SESSIONS.delete(sessionKey(token));
}

/** `__Host-`-prefixed cookie everywhere except local dev (which lacks HTTPS). */
export function sessionCookieName(env: Env): string {
  return env.ENVIRONMENT === "local" ? "evocsv-session" : "__Host-evocsv-session";
}

function buildCookie(env: Env, value: string, maxAge: number): string {
  const parts = [
    `${sessionCookieName(env)}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (env.ENVIRONMENT !== "local") parts.push("Secure");
  return parts.join("; ");
}

export function buildSetCookie(env: Env, token: string): string {
  return buildCookie(env, token, SESSION_TTL_SECONDS);
}

export function buildClearCookie(env: Env): string {
  return buildCookie(env, "", 0);
}

/** Extract this env's session cookie value from a Cookie header, or null. */
export function readSessionToken(cookieHeader: string | null | undefined, env: Env): string | null {
  if (!cookieHeader) return null;
  const name = sessionCookieName(env);
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export async function putOAuthState(env: Env, state: string, data: OAuthStateRow): Promise<void> {
  await env.SESSIONS.put(oauthStateKey(state), JSON.stringify(data), {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
}

/** Get + delete the OAuth state row (single-use). Returns null if absent/expired. */
export async function takeOAuthState(env: Env, state: string): Promise<OAuthStateRow | null> {
  const raw = await env.SESSIONS.get(oauthStateKey(state));
  if (!raw) return null;
  await env.SESSIONS.delete(oauthStateKey(state));
  try {
    return JSON.parse(raw) as OAuthStateRow;
  } catch {
    return null;
  }
}
