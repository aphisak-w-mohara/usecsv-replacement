import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config for the upload-wizard flow. It boots the whole stack the way
 * a real operator would hit it — worker (Cloudflare dev runtime) + web (Vite) —
 * plus a local webhook catcher standing in for the EVO Laravel endpoint, then
 * drives a browser through the 5-step wizard.
 *
 * Auth: the web build is started WITHOUT `VITE_FIREBASE_*`, so `firebaseConfigured`
 * is false and the SPA's dev bypass sends no token; the worker runs with
 * `ENVIRONMENT=local` + `DEV_EMAIL`, authorizing every request as the seeded
 * owner. That's "the actual user" minus Google's redirect (which needs a human).
 * To exercise real Google sign-in instead, build the web app with the
 * `VITE_FIREBASE_*` values from the provisioning runbook and sign in by hand.
 */
const WEB_PORT = 5173;
const WORKER_PORT = 8787;
const CATCHER_PORT = 9099;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Stand-in for the EVO Laravel webhook receiver. Records every delivery.
      command: "node e2e/webhook-catcher.mjs",
      url: `http://localhost:${CATCHER_PORT}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { CATCHER_PORT: String(CATCHER_PORT) },
      stdout: "pipe",
    },
    {
      // Apply local D1 migrations (idempotent — applies the seed: project, env,
      // imp_tenants importer + columns, owner) THEN start the worker dev runtime
      // in the local auth seam. Same --persist-to for both so they share state.
      command:
        "npx wrangler d1 migrations apply evo-csv-dev --local --persist-to .wrangler/e2e-state && " +
        "npx wrangler dev --port 8787 --persist-to .wrangler/e2e-state " +
        "--var ENVIRONMENT:local --var DEV_EMAIL:aphisak@mohara.co",
      cwd: "../worker",
      url: `http://localhost:${WORKER_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { CI: "1" },
      stdout: "pipe",
    },
    {
      // Vite dev server. Blank Firebase env → dev auth bypass (see header note).
      command: "pnpm dev",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_FIREBASE_API_KEY: "", VITE_FIREBASE_PROJECT_ID: "" },
      stdout: "pipe",
    },
  ],
});
