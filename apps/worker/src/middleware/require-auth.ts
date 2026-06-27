import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";
import { resolveSession } from "../lib/closed-signup.js";
import { verifyFirebaseToken } from "../lib/firebase.js";

/**
 * Stateless auth gate. There are no server sessions: the SPA holds the Firebase
 * session and sends `Authorization: Bearer <Firebase ID token>` per request;
 * this middleware re-derives the email each request and runs the closed-signup
 * gate (`resolveSession`) to authorize it.
 *
 * In production (`ENVIRONMENT !== "local"`) the bearer token is verified against
 * Firebase's JWKS — no header bypass exists.
 *
 * The `local` branch is a DEV/TEST-ONLY seam: local dev and the vitest pool
 * can't mint Google-signed Firebase ID tokens, so under `ENVIRONMENT === "local"`
 * the email is trusted from the `X-Dev-Email` header (falling back to the
 * `DEV_EMAIL` var). This branch is unreachable off `local`.
 *
 * Status contract: not authenticated → 401; authenticated but not authorized
 * (no membership / no matching invite / domain mismatch) → 403.
 */
export const requireAuth: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  let email: string | null;

  if (c.env.ENVIRONMENT === "local") {
    // DEV/TEST ONLY — gated strictly to ENVIRONMENT === "local".
    email = (c.req.header("X-Dev-Email") ?? c.env.DEV_EMAIL ?? "").toLowerCase() || null;
  } else {
    const auth = c.req.header("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const verified = await verifyFirebaseToken(c.env, token);
    if (!verified) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    email = verified.email;
  }

  if (!email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await resolveSession(c.env, email);
  if (result.kind === "forbidden") {
    return c.json({ error: "Not authorized. Ask a project owner for an invite." }, 403);
  }

  c.set("session", result.session);
  await next();
};
