import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
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
