import type { WebhookDispatchJob } from "@evo-csv/shared";
import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { dispatchBatch } from "./lib/dispatch.js";
import { requireSession } from "./middleware/require-session.js";
import { withEnvironment } from "./middleware/with-environment.js";
import { authRoutes } from "./routes/auth.js";
import { importersRoutes } from "./routes/importers.js";
import { projectsRoutes, publicInvitesRoutes } from "./routes/invites.js";
import { meRoutes } from "./routes/me.js";
import { uploadsRoutes } from "./routes/uploads.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  // Auth routes (login / callback / logout) must be reachable unauthenticated,
  // so they mount BEFORE the session gate.
  .route("/api/auth", authRoutes)
  // Public invite lookup: an invitee previews the invite before signing in, so
  // it also mounts BEFORE the session gate.
  .route("/api/invites", publicInvitesRoutes)
  .use("/api/*", requireSession)
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
  fetch: app.fetch,
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
};
