import { Hono } from "hono";
import type { Env, Variables } from "../env.js";
import { randomToken } from "../lib/encoding.js";
import { generateId } from "../lib/ids.js";
import {
  type GoogleIdTokenClaims,
  buildGoogleAuthUrl,
  decodeIdToken,
  exchangeCode,
  pkce,
} from "../lib/oauth.js";
import {
  buildClearCookie,
  buildSetCookie,
  createSession,
  deleteSession,
  putOAuthState,
  readSessionToken,
  takeOAuthState,
} from "../lib/session.js";

const VALID_GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const DEFAULT_RETURN_TO = "/admin/importers";

/**
 * Only allow same-origin, local absolute paths as a post-login redirect target.
 * Anything else (absolute URL, protocol-relative `//evil.com`, backslash trick)
 * falls back to the default — closes the open-redirect via `return_to`.
 */
export function safeReturnTo(returnTo: string | null): string {
  if (!returnTo) return DEFAULT_RETURN_TO;
  if (!returnTo.startsWith("/")) return DEFAULT_RETURN_TO;
  if (returnTo.startsWith("//") || returnTo.startsWith("/\\")) return DEFAULT_RETURN_TO;
  return returnTo;
}

/** Minimal HTML page for terminal auth states (403 / errors). */
function htmlPage(title: string, body: string, status: 400 | 403): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** The single closed-signup rejection — used by every gate branch that denies. */
function notAuthorized(): Response {
  return htmlPage("Not authorized", "Not authorized. Ask a project owner for an invite.", 403);
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  google_sub: string | null;
  last_active_project_id: string | null;
  last_active_environment_id: string | null;
};

type MembershipRow = {
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
};

/**
 * Resolve the project/environment/role a user should land on. Prefers the
 * user's last-active values when they still back a real membership; otherwise
 * falls back to the first membership's project + that project's default env.
 */
async function resolveLanding(env: Env, user: UserRow): Promise<MembershipRow | null> {
  const first = await env.DB.prepare(
    `SELECT m.project_id AS project_id, m.role AS role, e.id AS environment_id
       FROM memberships m
       JOIN environments e ON e.project_id = m.project_id AND e.is_default = 1
       WHERE m.user_id = ?
       ORDER BY m.project_id ASC
       LIMIT 1`,
  )
    .bind(user.id)
    .first<MembershipRow>();
  if (!first) return null;

  // Honour last-active values only if they still resolve to a membership the
  // user holds and an environment in that project.
  if (user.last_active_project_id && user.last_active_environment_id) {
    const valid = await env.DB.prepare(
      `SELECT m.role AS role
         FROM memberships m
         JOIN environments e ON e.id = ? AND e.project_id = m.project_id
         WHERE m.user_id = ? AND m.project_id = ?`,
    )
      .bind(user.last_active_environment_id, user.id, user.last_active_project_id)
      .first<{ role: "owner" | "member" }>();
    if (valid) {
      return {
        project_id: user.last_active_project_id,
        environment_id: user.last_active_environment_id,
        role: valid.role,
      };
    }
  }

  return first;
}

/** Persist the chosen landing as the user's last-active project/environment. */
async function writeLastActive(env: Env, userId: string, landing: MembershipRow): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET last_active_project_id = ?, last_active_environment_id = ? WHERE id = ?",
  )
    .bind(landing.project_id, landing.environment_id, userId)
    .run();
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/google/login", async (c) => {
    const returnTo = c.req.query("return_to") ?? null;
    const inviteToken = c.req.query("invite_token") ?? null;

    const { verifier, challenge } = await pkce();
    const state = randomToken();

    await putOAuthState(c.env, state, {
      verifier,
      return_to: returnTo,
      invite_token: inviteToken,
    });

    // The single MVP project's allowed_email_domain becomes the Google `hd`
    // hint when present.
    const project = await c.env.DB.prepare(
      "SELECT allowed_email_domain FROM projects ORDER BY created_at ASC LIMIT 1",
    ).first<{ allowed_email_domain: string | null }>();

    const url = buildGoogleAuthUrl({
      clientId: c.env.GOOGLE_CLIENT_ID,
      redirectUri: c.env.GOOGLE_REDIRECT_URI,
      state,
      codeChallenge: challenge,
      hd: project?.allowed_email_domain ?? null,
    });

    return c.redirect(url, 302);
  })
  .get("/google/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!state) {
      return htmlPage("Login expired", "Login expired, please try again.", 400);
    }
    const stored = await takeOAuthState(c.env, state);
    if (!stored || !code) {
      return htmlPage("Login expired", "Login expired, please try again.", 400);
    }

    // Exchange + decode. Network/parse failures fall through to a 400.
    let claims: GoogleIdTokenClaims;
    try {
      const token = await exchangeCode(c.env, { code, verifier: stored.verifier });
      claims = decodeIdToken(token.id_token);
    } catch {
      return htmlPage("Login failed", "Could not complete sign-in. Please try again.", 400);
    }

    // Trust boundary: the token came over TLS from Google's token endpoint, but
    // still assert audience + issuer so a token minted for another client can't
    // be replayed here.
    if (
      claims.aud !== c.env.GOOGLE_CLIENT_ID ||
      !claims.iss ||
      !VALID_GOOGLE_ISSUERS.has(claims.iss)
    ) {
      return notAuthorized();
    }

    const email = claims.email?.toLowerCase() ?? null;
    if (!email || claims.email_verified !== true) {
      return htmlPage(
        "Not authorized",
        "Your Google account did not return a verified email.",
        403,
      );
    }

    // --- Four-branch closed-signup gate (PRD-004 Story 2, step 5) ---

    // Branch 1: a users row already bound to this google_sub.
    let user = await c.env.DB.prepare(
      `SELECT id, email, name, google_sub, last_active_project_id, last_active_environment_id
         FROM users WHERE google_sub = ?`,
    )
      .bind(claims.sub)
      .first<UserRow>();

    // Branch 2: a users row by email with no google_sub yet → bind it.
    if (!user) {
      const byEmail = await c.env.DB.prepare(
        `SELECT id, email, name, google_sub, last_active_project_id, last_active_environment_id
           FROM users WHERE email = ?`,
      )
        .bind(email)
        .first<UserRow>();
      if (byEmail && byEmail.google_sub === null) {
        await c.env.DB.prepare("UPDATE users SET google_sub = ? WHERE id = ?")
          .bind(claims.sub, byEmail.id)
          .run();
        user = { ...byEmail, google_sub: claims.sub };
      } else if (byEmail) {
        // Email matches but is already bound to a different google_sub → reject.
        return notAuthorized();
      }
    }

    // Branch 3: no user, but a pending non-expired invite matches both the
    // email AND the invite_token carried through OAuth state.
    if (!user && stored.invite_token) {
      const now = Math.floor(Date.now() / 1000);
      let invite: {
        id: string;
        project_id: string;
        role: "owner" | "member";
      } | null = null;
      try {
        // Story 3 (#40) adds the invites table; guard so this branch can't crash
        // while the table is still absent.
        invite = await c.env.DB.prepare(
          `SELECT id, project_id, role
             FROM invites
             WHERE token = ? AND email = ? AND accepted_at IS NULL AND expires_at > ?`,
        )
          .bind(stored.invite_token, email, now)
          .first<{ id: string; project_id: string; role: "owner" | "member" }>();
      } catch {
        // invites table absent → no invite, fall through to branch 4.
        invite = null;
      }

      if (invite) {
        const userId = generateId("usr");
        const createdAt = now;
        const defaultEnv = await c.env.DB.prepare(
          "SELECT id FROM environments WHERE project_id = ? AND is_default = 1 LIMIT 1",
        )
          .bind(invite.project_id)
          .first<{ id: string }>();

        await c.env.DB.prepare(
          `INSERT INTO users (id, email, google_sub, name, created_at)
             VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(userId, email, claims.sub, claims.name ?? email, createdAt)
          .run();
        await c.env.DB.prepare(
          "INSERT INTO memberships (project_id, user_id, role) VALUES (?, ?, ?)",
        )
          .bind(invite.project_id, userId, invite.role)
          .run();
        await c.env.DB.prepare("UPDATE invites SET accepted_at = ? WHERE id = ?")
          .bind(now, invite.id)
          .run();

        user = {
          id: userId,
          email,
          name: claims.name ?? email,
          google_sub: claims.sub,
          last_active_project_id: invite.project_id,
          last_active_environment_id: defaultEnv?.id ?? null,
        };
      }
    }

    // Branch 4: none of the above → 403, create no user row.
    if (!user) {
      return notAuthorized();
    }

    const landing = await resolveLanding(c.env, user);
    if (!landing) {
      // User exists but has no membership — closed-signup edge; reject.
      return notAuthorized();
    }

    await writeLastActive(c.env, user.id, landing);

    const token = await createSession(c.env, {
      userId: user.id,
      projectId: landing.project_id,
      environmentId: landing.environment_id,
      role: landing.role,
    });

    const dest = safeReturnTo(stored.return_to);
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest,
        "Set-Cookie": buildSetCookie(c.env, token),
      },
    });
  })
  .post("/logout", async (c) => {
    const token = readSessionToken(c.req.header("Cookie"), c.env);
    if (token) {
      await deleteSession(c.env, token);
    }
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": buildClearCookie(c.env) },
    });
  });
