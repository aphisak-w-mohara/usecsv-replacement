/**
 * Bootstrap CLI (PRD-004 Story 1). Seeds a project, owner user, default
 * environment, and an owner membership in D1 so the first owner can sign in via
 * Google SSO without an open-signup hole.
 *
 *   pnpm bootstrap --email you@co --project-slug evo --project-name EVO
 *
 * Thin wrapper around `wrangler d1 execute` — all SQL/validation logic lives in
 * apps/worker/src/lib/bootstrap.ts so it is unit + integration tested.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  BootstrapError,
  buildBootstrapStatements,
  newIds,
  parseArgs,
} from "../apps/worker/src/lib/bootstrap.js";

function main(): void {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof BootstrapError ? err.message : String(err));
    process.exit(1);
  }

  const ids = newIds();
  const now = Math.floor(Date.now() / 1000);
  const sql = buildBootstrapStatements(opts, ids, now).join("\n");

  const workerDir = resolve(fileURLToPath(import.meta.url), "../../apps/worker");
  const tmp = mkdtempSync(join(tmpdir(), "evo-bootstrap-"));
  const sqlFile = join(tmp, "bootstrap.sql");
  writeFileSync(sqlFile, sql);

  const target = opts.remote ? "--remote" : "--local";
  console.error(`Running bootstrap against D1 (${target})…`);
  const res = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", target, "--file", sqlFile, "--yes"],
    { cwd: workerDir, stdio: ["inherit", "inherit", "inherit"] },
  );
  rmSync(tmp, { recursive: true, force: true });

  if (res.status !== 0) {
    console.error("\nbootstrap failed — see wrangler output above.");
    process.exit(res.status ?? 1);
  }

  const base = opts.remote ? "https://app.evo-csv" : "http://localhost:5173";
  console.log("\n✓ Bootstrap complete");
  console.log(`  project   ${ids.projectId}  (slug: ${opts.projectSlug})`);
  console.log(`  owner     ${ids.userId}  (${opts.email})`);
  console.log(`  default env ${ids.environmentId}  (slug: ${opts.environmentSlug})`);
  if (opts.allowedEmailDomain) console.log(`  allowed_email_domain  ${opts.allowedEmailDomain}`);
  console.log(`\n  Sign in:  ${base}/login`);
}

main();
