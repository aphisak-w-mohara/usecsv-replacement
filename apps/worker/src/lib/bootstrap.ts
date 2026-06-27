/**
 * Pure logic for the bootstrap CLI (PRD-004 Story 1). Kept free of node: imports
 * so it can be unit + integration tested inside the worker (workerd) test pool.
 * The thin shell that actually shells `wrangler d1 execute` lives in
 * `tools/bootstrap.ts`.
 */
import { generateId } from "./ids.js";

export interface BootstrapOptions {
  email: string;
  projectSlug: string;
  projectName: string;
  name: string;
  allowedEmailDomain: string | null;
  environmentSlug: string;
  environmentName: string;
  remote: boolean;
}

export interface BootstrapIds {
  projectId: string;
  userId: string;
  environmentId: string;
}

/** Thrown for usage / validation errors. The CLI maps this to exit code 1. */
export class BootstrapError extends Error {}

export const USAGE = `Usage: pnpm bootstrap --email <email> --project-slug <slug> --project-name <name>
  [--name <display name>]          (default: local-part of --email)
  [--allowed-email-domain <domain>]
  [--environment-slug <slug>]      (default: staging)
  [--environment-name <name>]      (default: Staging)
  [--remote]                       (default: --local)`;

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

/** Parse argv (after `node script.ts`) into validated options. Throws BootstrapError. */
export function parseArgs(argv: string[]): BootstrapOptions {
  const raw: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || !a.startsWith("--")) {
      throw new BootstrapError(`Unexpected argument: ${a}\n${USAGE}`);
    }
    const key = a.slice(2);
    if (key === "remote" || key === "local") {
      raw[key] = true;
      continue;
    }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      throw new BootstrapError(`Missing value for --${key}\n${USAGE}`);
    }
    raw[key] = val;
    i++;
  }

  // Trimmed string value for a flag, or undefined if absent/boolean.
  const str = (v: string | boolean | undefined): string | undefined =>
    typeof v === "string" ? v.trim() : undefined;

  const email = (str(raw.email) ?? "").toLowerCase();
  const projectSlug = str(raw["project-slug"]) ?? "";
  const projectName = str(raw["project-name"]) ?? "";
  if (!email) throw new BootstrapError(`--email is required\n${USAGE}`);
  if (!projectSlug) throw new BootstrapError(`--project-slug is required\n${USAGE}`);
  if (!projectName) throw new BootstrapError(`--project-name is required\n${USAGE}`);
  if (!email.includes("@")) throw new BootstrapError(`--email is not a valid email: ${email}`);

  const opts: BootstrapOptions = {
    email,
    projectSlug,
    projectName,
    name: str(raw.name) || (email.split("@")[0] ?? email),
    allowedEmailDomain: str(raw["allowed-email-domain"])?.toLowerCase() || null,
    environmentSlug: str(raw["environment-slug"]) ?? "staging",
    environmentName: str(raw["environment-name"]) ?? "Staging",
    remote: raw.remote === true,
  };

  validate(opts);
  return opts;
}

/** Throws BootstrapError if the owner email doesn't match a set allowed_email_domain. */
export function validate(opts: BootstrapOptions): void {
  if (opts.allowedEmailDomain && domainOf(opts.email) !== opts.allowedEmailDomain) {
    throw new BootstrapError(
      `Owner email does not match allowed_email_domain. Use a matching email or omit the flag.`,
    );
  }
}

export function newIds(): BootstrapIds {
  return {
    projectId: generateId("proj"),
    userId: generateId("usr"),
    environmentId: generateId("env"),
  };
}

// SQLite string literal. Doubles the single quote (the only metacharacter that
// matters inside a SQLite string). Inputs are operator-supplied CLI args (a
// trusted boundary), not request data, and `wrangler d1 execute --file` has no
// bind-param channel — so a raw literal is the right tool here.
function lit(v: string | null): string {
  if (v === null) return "NULL";
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Build the ordered SQL statements. Idempotent:
 *  - projects/users/environments use INSERT OR IGNORE (slug/email/UNIQUE keyed),
 *    so generated ids only land on first insert.
 *  - FKs are resolved by sub-select on the natural key, so membership/environment
 *    bind to the *existing* row's id whether it came from the seed or a prior run.
 *  - membership uses INSERT OR REPLACE → re-running upserts the role to 'owner'.
 */
export function buildBootstrapStatements(
  opts: BootstrapOptions,
  ids: BootstrapIds,
  now: number,
): string[] {
  const {
    email,
    projectSlug,
    projectName,
    name,
    allowedEmailDomain,
    environmentSlug,
    environmentName,
  } = opts;
  return [
    `INSERT OR IGNORE INTO projects (id, slug, name, allowed_email_domain, created_at)
     VALUES (${lit(ids.projectId)}, ${lit(projectSlug)}, ${lit(projectName)}, ${lit(allowedEmailDomain)}, ${now});`,
    `INSERT OR IGNORE INTO users (id, email, name, created_at)
     VALUES (${lit(ids.userId)}, ${lit(email)}, ${lit(name)}, ${now});`,
    `INSERT OR IGNORE INTO environments (id, project_id, slug, name, is_default, created_at)
     SELECT ${lit(ids.environmentId)}, p.id, ${lit(environmentSlug)}, ${lit(environmentName)}, 1, ${now}
     FROM projects p WHERE p.slug = ${lit(projectSlug)};`,
    `INSERT OR REPLACE INTO memberships (project_id, user_id, role)
     SELECT p.id, u.id, 'owner'
     FROM projects p, users u WHERE p.slug = ${lit(projectSlug)} AND u.email = ${lit(email)};`,
  ];
}
