import type { WebhookDispatchJob } from "@evo-csv/shared";
import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { alertHaltedUploads } from "./lib/alerts.js";
import { dispatchBatch } from "./lib/dispatch.js";
import { purgeDeliveredPayloads } from "./lib/retention.js";
import { requireAuth } from "./middleware/require-auth.js";
import { withEnvironment } from "./middleware/with-environment.js";
import { importersRoutes } from "./routes/importers.js";
import { projectsRoutes, publicInvitesRoutes } from "./routes/invites.js";
import { meRoutes } from "./routes/me.js";
import { uploadsRoutes } from "./routes/uploads.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  // Public invite lookup: an invitee previews the invite before signing in, so
  // it mounts BEFORE the auth gate.
  .route("/api/invites", publicInvitesRoutes)
  // Stateless auth gate: verifies the Firebase ID token (Authorization: Bearer)
  // and runs the closed-signup gate per request. No logout endpoint — the SPA
  // ends the session client-side via Firebase signOut().
  .use("/api/*", requireAuth)
  .route("/api/me", meRoutes)
  // Env-scoped data: a member must hold a grant for the active environment, else
  // 404 (IDOR). Owners bypass. Project-level routes (`/api/projects`) are NOT
  // env-gated — they're owner-only via `requireProjectOwner` instead.
  // Both the bare collection path and the `/*` subtree are gated — a bare
  // `GET /api/importers` doesn't match the `/*` wildcard on its own.
  .use("/api/importers", withEnvironment)
  .use("/api/importers/*", withEnvironment)
  .use("/api/uploads", withEnvironment)
  .use("/api/uploads/*", withEnvironment)
  .route("/api/importers", importersRoutes)
  .route("/api/projects", projectsRoutes)
  .route("/api/uploads", uploadsRoutes);

export type AppType = typeof app;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    // The Hono app owns the API; everything else is delegated to the asset
    // binding, which serves the matching static file or — for unknown client
    // routes — SPA-falls-back to index.html (not_found_handling, 200, no
    // redirect). The Worker runs first for all paths (run_worker_first = true).
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  async queue(batch: MessageBatch<WebhookDispatchJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await dispatchBatch(env, message.body);
      } catch (err) {
        // Log but still ack. webhook_attempts uses INSERT OR IGNORE, so a
        // redelivery would be a no-op for already-recorded attempts; acking
        // here prevents a redelivery storm on persistent D1/R2 errors.
        console.error("dispatchBatch threw unexpectedly:", err);
      }
      message.ack();
    }
  },
  // Cron-triggered maintenance (see [triggers] in wrangler.toml). Kept thin: the
  // real, unit-tested logic lives in lib/alerts.ts and lib/retention.ts.
  //  - alertHaltedUploads: surface uploads that exhausted webhook retries (#74).
  //  - purgeDeliveredPayloads: null out delivered client PII past retention (#75).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Run the two jobs concurrently and independently — a slow/hanging alert
    // webhook must not delay (or starve) the PII purge, and vice versa.
    const now = Math.floor(Date.now() / 1000);
    ctx.waitUntil(
      Promise.allSettled([
        alertHaltedUploads(env).catch((err) =>
          console.error("scheduled: alertHaltedUploads threw:", err),
        ),
        purgeDeliveredPayloads(env, now).catch((err) =>
          console.error("scheduled: purgeDeliveredPayloads threw:", err),
        ),
      ]),
    );
  },
};
