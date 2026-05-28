import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, inject } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    DEV_USER_EMAIL: string;
    UPLOADS_BUCKET: R2Bucket;
    WEBHOOK_QUEUE: Queue;
  }
}

declare module "vitest" {
  interface ProvidedContext {
    d1Migrations: D1Migration[];
  }
}

beforeAll(async () => {
  const migrations = inject("d1Migrations");
  await applyD1Migrations(env.DB, migrations);
});
