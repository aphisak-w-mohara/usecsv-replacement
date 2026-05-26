import { Hono } from "hono";
import type { Env, Variables } from "../env.js";

export const importersRoutes = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/:importer_id/columns",
  async (c) => {
    return c.json({ error: "not implemented" }, 501);
  },
);
