import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";

/**
 * Environment-access gate for env-scoped routes (uploads, importer_environments).
 *
 * Owners bypass — they implicitly access every environment in the project, so no
 * `environment_grants` row is required. Members must have a grant row matching
 * the active session's `(project_id, user_id, environment_id)`; a missing grant
 * returns **404, not 403**, to avoid leaking environment existence — same IDOR
 * pattern as cross-project access (PRD-002 §4 / PRD-004 Story 4 AC #6).
 *
 * Mount AFTER `requireAuth`, so `c.var.session` is populated.
 */
export const withEnvironment: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const session = c.get("session");

  if (session.role === "owner") {
    await next();
    return;
  }

  const grant = await c.env.DB.prepare(
    `SELECT 1 FROM environment_grants
       WHERE project_id = ? AND user_id = ? AND environment_id = ?`,
  )
    .bind(session.project_id, session.user.id, session.environment_id)
    .first();

  if (!grant) {
    return c.json({ error: "Not found" }, 404);
  }

  await next();
};
