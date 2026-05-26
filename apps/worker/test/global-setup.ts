import path from "node:path";
import { readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";

export async function setup({ provide }: { provide: (key: string, value: unknown) => void }) {
  const migrationsPath = path.resolve(import.meta.dirname, "../migrations");
  const migrations: D1Migration[] = await readD1Migrations(migrationsPath);
  provide("d1Migrations", migrations);
}
