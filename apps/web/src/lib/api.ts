import type { AppType } from "@evo-csv/worker/types";
import { hc } from "hono/client";
import { firebaseConfigured, getIdToken } from "./firebase";

/**
 * Typed RPC client for the worker's Hono app.
 *
 * Usage: `await api.api.uploads.$post({ json: payload })`
 *
 * The `import type` keeps the worker's runtime code out of the web bundle —
 * we only import the type, not the implementation.
 *
 * Auth is stateless: every request carries the caller's Firebase ID token as
 * `Authorization: Bearer <token>` (the worker verifies it per request). The
 * token is fetched fresh per request via the SDK, which transparently refreshes
 * it when near expiry.
 *
 * DEV bypass: in `import.meta.env.DEV` with no Firebase project configured, no
 * token is attached — the worker's `local` seam authorizes via DEV_EMAIL so
 * `pnpm dev` works without a real Firebase project. This branch is unreachable
 * in a production build (DEV is false) and whenever Firebase IS configured.
 */
const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

const authedFetch: typeof fetch = async (input, init) => {
  if (import.meta.env.DEV && !firebaseConfigured) {
    return fetch(input, init);
  }
  const token = await getIdToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

export const api = hc<AppType>(baseUrl, { fetch: authedFetch });
