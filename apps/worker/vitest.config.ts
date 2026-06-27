import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Vitest is held at 3.x with @cloudflare/vitest-pool-workers ^0.12 on purpose.
// The vitest-4 line of the pool (0.13+) rewrote the config API (cloudflareTest
// plugin) and DROPPED the `singleWorker` / `isolatedStorage` options this suite
// relies on (see below). Taking vitest 4 needs that test-architecture rework, so
// keep vitest <4 and ignore dependabot's vitest-4 bumps until then.
export default defineWorkersConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        // wrangler.toml ships ENVIRONMENT="production" (secure default); the test
        // suite needs the "local" auth seam (X-Dev-Email), so override it here —
        // this keeps the dev bypass out of the committed/deployed config.
        miniflare: {
          bindings: { ENVIRONMENT: "local", DEV_EMAIL: "aphisak@mohara.co" },
        },
        // Run all test files in a single worker instance with shared storage.
        // With the queue() consumer active, miniflare fires queue messages
        // within the same event loop as the test that enqueued them; per-test
        // isolated storage frames conflict with those async queue callbacks.
        // Tests apply D1 migrations in beforeAll, so shared storage is safe.
        singleWorker: true,
        isolatedStorage: false,
      },
    },
  },
});
