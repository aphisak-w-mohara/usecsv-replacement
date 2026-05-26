import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { devSession } from "./middleware/dev-session.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  .use("/api/*", devSession)
  .get("/api/whoami", (c) => c.json(c.get("session")));

export type AppType = typeof app;
export default app;
