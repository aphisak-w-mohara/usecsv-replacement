import { Hono } from "hono";
import type { Env } from "./env.js";

const app = new Hono<{ Bindings: Env }>().get("/api/health", (c) => c.json({ ok: true }));

export type AppType = typeof app;
export default app;
