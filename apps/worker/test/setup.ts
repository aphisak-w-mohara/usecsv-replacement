import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, inject } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

declare module "vitest" {
  interface ProvidedContext {
    d1Migrations: D1Migration[];
  }
}

beforeAll(async () => {
  const migrations = inject("d1Migrations");
  // @ts-expect-error — ProvidedEnv doesn't know about DB but it is bound via wrangler.toml
  await applyD1Migrations(env.DB, migrations);
});
