import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    // The Playwright E2E specs live under e2e/ and import @playwright/test —
    // they must NOT be picked up by the unit (vitest) runner.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
});
