import type { AppType } from "@evo-csv/worker/types";
import { hc } from "hono/client";

/**
 * Typed RPC client for the worker's Hono app.
 *
 * Usage: `await api.api.uploads.$post({ json: payload })`
 *
 * The `import type` keeps the worker's runtime code out of the web bundle —
 * we only import the type, not the implementation.
 */
export const api = hc<AppType>(typeof window !== "undefined" ? window.location.origin : "");
