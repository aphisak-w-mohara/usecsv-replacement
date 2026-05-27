import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { dispatchBatch } from "./lib/dispatch.js";
import { devSession } from "./middleware/dev-session.js";
import { importersRoutes } from "./routes/importers.js";
import { uploadsRoutes } from "./routes/uploads.js";
import type { WebhookDispatchJob } from "@evo-csv/shared";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  .use("/api/*", devSession)
  .get("/api/whoami", (c) => c.json(c.get("session")))
  .route("/api/importers", importersRoutes)
  .route("/api/uploads", uploadsRoutes);

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<WebhookDispatchJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await dispatchBatch(env, message.body);
      message.ack();
    }
  },
};
