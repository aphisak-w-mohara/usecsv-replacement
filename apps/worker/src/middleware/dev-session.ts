import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";

/**
 * TEMPORARY dev-only auth stub. Looks up the user named by DEV_USER_EMAIL
 * in the D1 seed data and pretends they're signed in. Replace this entire
 * file with the real Google SSO middleware when the Auth Epic ships.
 */
export const devSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const email = c.env.DEV_USER_EMAIL;
  if (!email) {
    return c.json({ error: "DEV_USER_EMAIL not set" }, 500);
  }

  try {
    const user = await c.env.DB.prepare("SELECT id, email, name FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string; email: string; name: string }>();

    if (!user) {
      return c.json({ error: `Dev user not found: ${email}` }, 500);
    }

    const membership = await c.env.DB.prepare(
      `SELECT m.project_id, m.role, e.id AS environment_id
         FROM memberships m
         JOIN environments e ON e.project_id = m.project_id AND e.is_default = 1
         WHERE m.user_id = ?
         ORDER BY m.project_id ASC
         LIMIT 1`,
    )
      .bind(user.id)
      .first<{
        project_id: string;
        environment_id: string;
        role: "owner" | "member";
      }>();

    if (!membership) {
      return c.json({ error: "Dev user has no membership" }, 500);
    }

    c.set("session", {
      user,
      project_id: membership.project_id,
      environment_id: membership.environment_id,
      role: membership.role,
    });

    await next();
  } catch {
    return c.json({ error: "Database error during dev session setup" }, 500);
  }
};
