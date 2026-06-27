import { SELF } from "cloudflare:test";

/** The 0001 seed owner — the default identity for authed test requests. */
export const OWNER_EMAIL = "aphisak@mohara.co";

/**
 * `SELF.fetch` wrapper that authenticates via the worker's `local` dev seam:
 * with `ENVIRONMENT === "local"` (the test vars), `requireAuth` trusts the
 * `X-Dev-Email` header and runs the real closed-signup gate against it. There's
 * no token/cookie/KV seeding — to act as a member, insert the member's
 * user + membership (+ grant) in D1 first, then pass that email here.
 *
 * Defaults to the seeded owner's email.
 */
export function authedFetch(
  path: string,
  init: RequestInit = {},
  email: string = OWNER_EMAIL,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Dev-Email", email);
  return SELF.fetch(path, { ...init, headers });
}
