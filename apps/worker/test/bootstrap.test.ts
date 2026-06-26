import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BootstrapError, buildBootstrapStatements, newIds, parseArgs } from "../src/lib/bootstrap";

// Worker tests share storage (isolatedStorage: false), so every test uses a
// unique slug/domain tag to stay isolated from the 0001 seed and from each other.
function bootOpts(tag: string, allowedDomain?: string) {
  const args = [
    "--email",
    `owner@${tag}.test`,
    "--project-slug",
    tag,
    "--project-name",
    tag.toUpperCase(),
  ];
  if (allowedDomain) args.push("--allowed-email-domain", allowedDomain);
  return parseArgs(args);
}

async function runBootstrap(o: ReturnType<typeof parseArgs>, now = 1_700_000_000): Promise<void> {
  for (const sql of buildBootstrapStatements(o, newIds(), now)) {
    await env.DB.prepare(sql).run();
  }
}

async function countFor(tag: string) {
  const projId = (
    await env.DB.prepare("SELECT id FROM projects WHERE slug = ?").bind(tag).first<{ id: string }>()
  )?.id;
  const u = await env.DB.prepare("SELECT COUNT(*) n FROM users WHERE email LIKE ?")
    .bind(`%@${tag}.test`)
    .first<{ n: number }>();
  const e = await env.DB.prepare("SELECT COUNT(*) n FROM environments WHERE project_id = ?")
    .bind(projId ?? "")
    .first<{ n: number }>();
  const m = await env.DB.prepare("SELECT COUNT(*) n FROM memberships WHERE project_id = ?")
    .bind(projId ?? "")
    .first<{ n: number }>();
  return { projects: projId ? 1 : 0, users: u?.n ?? 0, envs: e?.n ?? 0, memberships: m?.n ?? 0 };
}

describe("parseArgs", () => {
  it("requires --email, --project-slug, --project-name", () => {
    expect(() => parseArgs(["--email", "a@b.co"])).toThrow(BootstrapError);
    expect(() => parseArgs(["--project-slug", "x", "--project-name", "X"])).toThrow(BootstrapError);
  });

  it("defaults environment to staging/Staging and target to local", () => {
    const o = bootOpts("defaults");
    expect(o.environmentSlug).toBe("staging");
    expect(o.environmentName).toBe("Staging");
    expect(o.remote).toBe(false);
  });

  it("rejects an owner email that doesn't match --allowed-email-domain", () => {
    expect(() =>
      parseArgs([
        "--email",
        "x@gmail.com",
        "--project-slug",
        "acme",
        "--project-name",
        "Acme",
        "--allowed-email-domain",
        "acme.test",
      ]),
    ).toThrow(/does not match allowed_email_domain/);
  });

  it("accepts a matching allowed-email-domain", () => {
    const o = bootOpts("match", "match.test");
    expect(o.allowedEmailDomain).toBe("match.test");
  });
});

describe("buildBootstrapStatements (integration against test D1)", () => {
  it("creates 1 project, 1 user, 1 env, 1 owner membership on a fresh slug", async () => {
    await runBootstrap(bootOpts("fresh"));
    expect(await countFor("fresh")).toEqual({ projects: 1, users: 1, envs: 1, memberships: 1 });

    const m = await env.DB.prepare(
      "SELECT role FROM memberships WHERE user_id = (SELECT id FROM users WHERE email='owner@fresh.test')",
    ).first<{ role: string }>();
    expect(m?.role).toBe("owner");
  });

  it("re-running identical is a no-op (no duplicates)", async () => {
    await runBootstrap(bootOpts("noop"));
    await runBootstrap(bootOpts("noop"));
    expect(await countFor("noop")).toEqual({ projects: 1, users: 1, envs: 1, memberships: 1 });
  });

  it("a second owner email against the same project adds a user + owner membership", async () => {
    await runBootstrap(bootOpts("second"));
    await runBootstrap(
      parseArgs([
        "--email",
        "second@second.test",
        "--project-slug",
        "second",
        "--project-name",
        "S",
      ]),
    );
    const c = await countFor("second");
    expect(c.projects).toBe(1);
    expect(c.users).toBe(2);
    expect(c.memberships).toBe(2);
  });

  it("re-bootstrap upserts a demoted member back to owner", async () => {
    await runBootstrap(bootOpts("demote"));
    await env.DB.prepare(
      "UPDATE memberships SET role='member' WHERE user_id = (SELECT id FROM users WHERE email='owner@demote.test')",
    ).run();
    await runBootstrap(bootOpts("demote"));
    const m = await env.DB.prepare(
      "SELECT role FROM memberships WHERE user_id = (SELECT id FROM users WHERE email='owner@demote.test')",
    ).first<{ role: string }>();
    expect(m?.role).toBe("owner");
  });

  it("stores allowed_email_domain on the project", async () => {
    await runBootstrap(bootOpts("domain", "domain.test"));
    const proj = await env.DB.prepare(
      "SELECT allowed_email_domain FROM projects WHERE slug='domain'",
    ).first<{
      allowed_email_domain: string;
    }>();
    expect(proj?.allowed_email_domain).toBe("domain.test");
  });
});
