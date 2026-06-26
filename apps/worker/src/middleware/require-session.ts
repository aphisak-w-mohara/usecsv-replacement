import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";
import { getSession, readSessionToken } from "../lib/session.js";

/**
 * Real session gate. Reads the opaque session cookie, validates it against KV
 * (bumping the rolling TTL), loads the user from D1, and attaches the session
 * to `c.var.session`. 401s on any miss — there is no env-gated bypass and no
 * dev backdoor; the only way in is a KV-backed session cookie.
 */
export const requireSession: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const token = readSessionToken(c.req.header("Cookie"), c.env);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const session = await getSession(c.env, token);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const user = await c.env.DB.prepare("SELECT id, email, name, picture_url FROM users WHERE id = ?")
    .bind(session.user_id)
    .first<{ id: string; email: string; name: string; picture_url: string | null }>();
  if (!user) {
    // Session points at a user that no longer exists — treat as logged out.
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("session", {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture_url: user.picture_url,
    },
    project_id: session.project_id,
    environment_id: session.environment_id,
    role: session.role,
  });

  await next();
};
