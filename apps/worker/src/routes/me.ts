import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { buildSetCookie, readSessionToken, updateSession } from "../lib/session.js";

const switchEnvSchema = z.object({
  environment_id: z.string().min(1),
});

/**
 * Session-scoped endpoints under `/api/me`. Mounted behind `requireSession`.
 *
 * `GET /api/me` extends the raw session with `accessible_environments` so the
 * SPA can render the env switcher and gate UI: owners see every environment in
 * the project; members see only the ones they hold a grant for.
 *
 * `POST /api/me/environment` switches the active environment, validating the
 * target is accessible (owner → any env in the project; member → a granted env),
 * persisting it to the session (KV) and the user's `last_active_environment_id`.
 */
export const meRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/", async (c) => {
    const session = c.get("session");

    const accessible = await accessibleEnvironments(c.env, session);

    return c.json({
      user: session.user,
      project_id: session.project_id,
      environment_id: session.environment_id,
      role: session.role,
      accessible_environments: accessible,
    });
  })
  .post("/environment", zValidator("json", switchEnvSchema), async (c) => {
    const session = c.get("session");
    const { environment_id } = c.req.valid("json");

    const accessible = await accessibleEnvironments(c.env, session);
    const target = accessible.find((e) => e.id === environment_id);
    // 404 (not 403) for an inaccessible target — matches the IDOR pattern: don't
    // leak that the environment exists at all.
    if (!target) {
      return c.json({ error: "Not found" }, 404);
    }

    const token = readSessionToken(c.req.header("Cookie"), c.env);
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await updateSession(c.env, token, { environment_id });

    await c.env.DB.prepare("UPDATE users SET last_active_environment_id = ? WHERE id = ?")
      .bind(environment_id, session.user.id)
      .run();

    return c.json(
      { environment: target },
      200,
      // Re-issue the cookie so the rolling TTL window is preserved on switch.
      { "Set-Cookie": buildSetCookie(c.env, token) },
    );
  });

type AccessibleEnv = { id: string; slug: string; name: string };

/**
 * Environments the session's user may use: owners → all envs in the project;
 * members → only envs with a matching `environment_grants` row.
 */
async function accessibleEnvironments(
  env: Env,
  session: Variables["session"],
): Promise<AccessibleEnv[]> {
  if (session.role === "owner") {
    const result = await env.DB.prepare(
      `SELECT id, slug, name FROM environments
         WHERE project_id = ?
         ORDER BY is_default DESC, slug ASC`,
    )
      .bind(session.project_id)
      .all<AccessibleEnv>();
    return result.results;
  }

  const result = await env.DB.prepare(
    `SELECT e.id, e.slug, e.name FROM environments e
       JOIN environment_grants g
         ON g.environment_id = e.id
        AND g.project_id = e.project_id
        AND g.user_id = ?
       WHERE e.project_id = ?
       ORDER BY e.is_default DESC, e.slug ASC`,
  )
    .bind(session.user.id, session.project_id)
    .all<AccessibleEnv>();
  return result.results;
}
