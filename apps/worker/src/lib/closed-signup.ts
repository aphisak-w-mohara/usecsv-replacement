import type { Env, SessionContext } from "../env.js";
import { domainOf } from "./domain.js";
import { generateId } from "./ids.js";

/**
 * The closed-signup authorization gate (PRD-004), now identity-by-verified-email
 * rather than by Google `sub`. Firebase has already authenticated the email;
 * this decides whether that email may act, and as whom.
 *
 * `resolveSession(env, email)` returns either an `ok` result carrying the full
 * `SessionContext` the request runs under, or `forbidden`. Branches:
 *  1. `allowed_email_domain` set and the email's domain doesn't match → forbidden.
 *  2. A `users` row exists for the email → resolve landing (project/env/role,
 *     honouring last-active); no membership → forbidden.
 *  3. No user but a pending, non-expired invite matches the email → materialize
 *     user + membership at the invite role + mark accepted_at, then land. This is
 *     the lazy invite acceptance: the first authed request whose email matches a
 *     pending invite turns it into a real membership, once.
 *  4. Otherwise → forbidden (no user row created).
 */
export type ResolveResult = { kind: "ok"; session: SessionContext } | { kind: "forbidden" };

type UserRow = {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  last_active_project_id: string | null;
  last_active_environment_id: string | null;
};

type MembershipRow = {
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
};

/** The single MVP project's `allowed_email_domain` (null when unset). */
export async function loadAllowedDomain(env: Env): Promise<string | null> {
  const project = await env.DB.prepare(
    "SELECT allowed_email_domain FROM projects ORDER BY created_at ASC LIMIT 1",
  ).first<{ allowed_email_domain: string | null }>();
  return project?.allowed_email_domain ?? null;
}

/**
 * Resolve the project/environment/role a user should land on. Prefers the
 * user's last-active values when they still back a real membership; otherwise
 * falls back to the first membership's project + that project's default env.
 */
export async function resolveLanding(env: Env, user: UserRow): Promise<MembershipRow | null> {
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
export async function writeLastActive(
  env: Env,
  userId: string,
  landing: MembershipRow,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET last_active_project_id = ?, last_active_environment_id = ? WHERE id = ?",
  )
    .bind(landing.project_id, landing.environment_id, userId)
    .run();
}

function sessionFrom(user: UserRow, landing: MembershipRow): SessionContext {
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture_url: user.picture_url,
    },
    project_id: landing.project_id,
    environment_id: landing.environment_id,
    role: landing.role,
  };
}

export async function resolveSession(env: Env, email: string): Promise<ResolveResult> {
  const normalized = email.toLowerCase();

  // Branch 1: allowed_email_domain gate (PRD-004 Story 5). The domain lookup and
  // the user lookup are independent, so run them together (one round-trip, not two).
  const [allowedDomain, user] = await Promise.all([
    loadAllowedDomain(env),
    env.DB.prepare(
      `SELECT id, email, name, picture_url, last_active_project_id, last_active_environment_id
         FROM users WHERE email = ?`,
    )
      .bind(normalized)
      .first<UserRow>(),
  ]);
  if (allowedDomain && domainOf(normalized) !== allowedDomain) {
    return { kind: "forbidden" };
  }

  // Branch 2: an existing users row by email.
  if (user) {
    const landing = await resolveLanding(env, user);
    if (!landing) {
      // User exists but holds no membership — closed-signup edge; reject.
      return { kind: "forbidden" };
    }
    // Persist last-active only when it actually changed — this runs on every
    // authenticated request, so skipping the no-op keeps a D1 write off the hot path.
    if (
      landing.project_id !== user.last_active_project_id ||
      landing.environment_id !== user.last_active_environment_id
    ) {
      await writeLastActive(env, user.id, landing);
    }
    return { kind: "ok", session: sessionFrom(user, landing) };
  }

  // Branch 3: no user, but a pending non-expired invite matches the email →
  // lazily materialize the user + membership and mark the invite accepted.
  const now = Math.floor(Date.now() / 1000);
  let invite: { id: string; project_id: string; role: "owner" | "member" } | null = null;
  try {
    invite = await env.DB.prepare(
      `SELECT id, project_id, role
         FROM invites
         WHERE email = ? AND accepted_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC
         LIMIT 1`,
    )
      .bind(normalized, now)
      .first<{ id: string; project_id: string; role: "owner" | "member" }>();
  } catch {
    // invites table absent → no invite, fall through to branch 4.
    invite = null;
  }

  if (invite) {
    // Resolve the landing env BEFORE mutating, so a project with no default env
    // fails closed without leaving a half-materialized user behind.
    const defaultEnv = await env.DB.prepare(
      "SELECT id FROM environments WHERE project_id = ? AND is_default = 1 LIMIT 1",
    )
      .bind(invite.project_id)
      .first<{ id: string }>();
    if (!defaultEnv) {
      return { kind: "forbidden" };
    }

    const userId = generateId("usr");
    const name = normalized.includes("@")
      ? normalized.slice(0, normalized.indexOf("@"))
      : normalized;

    await env.DB.prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)")
      .bind(userId, normalized, name, now)
      .run();
    await env.DB.prepare("INSERT INTO memberships (project_id, user_id, role) VALUES (?, ?, ?)")
      .bind(invite.project_id, userId, invite.role)
      .run();
    await env.DB.prepare("UPDATE invites SET accepted_at = ? WHERE id = ?")
      .bind(now, invite.id)
      .run();

    // The new user holds exactly one membership (just inserted) → land on it
    // directly; no resolveLanding round-trip needed.
    const landing: MembershipRow = {
      project_id: invite.project_id,
      environment_id: defaultEnv.id,
      role: invite.role,
    };
    await writeLastActive(env, userId, landing);
    const newUser: UserRow = {
      id: userId,
      email: normalized,
      name,
      picture_url: null,
      last_active_project_id: invite.project_id,
      last_active_environment_id: defaultEnv.id,
    };
    return { kind: "ok", session: sessionFrom(newUser, landing) };
  }

  // Branch 4: none of the above → forbidden, no user row created.
  return { kind: "forbidden" };
}
