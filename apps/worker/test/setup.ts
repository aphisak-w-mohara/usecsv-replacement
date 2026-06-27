import { applyD1Migrations, env } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import { beforeAll, inject } from "vitest";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    WEBHOOK_QUEUE: Queue;
    ENVIRONMENT: string;
    FIREBASE_PROJECT_ID: string;
    DEV_EMAIL: string;
    APP_BASE_URL: string;
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
