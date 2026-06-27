import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { domainOf, isValidDomain } from "../lib/domain.js";
import { randomToken } from "../lib/encoding.js";
import { generateId } from "../lib/ids.js";

/** 7 days in seconds — the invite validity window. */
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

const inviteCreateSchema = z.object({
  email: z.string().min(1).max(320).email(),
  role: z.enum(["owner", "member"]).default("member"),
});

/**
 * `allowed_email_domain` patch body (PRD-004 Story 5). An empty string clears
 * the restriction (stored as NULL); any other value is validated as a domain
 * and stored lowercased.
 */
const projectPatchSchema = z.object({
  allowed_email_domain: z.string().max(255).nullable(),
});

/**
 * Project-scope + owner gate for every `/:id/*` route below. Cross-project
 * access → 404 (IDOR: don't leak existence); non-owner → 403. Asserted once
 * here so a new endpoint can't silently ship ungated.
 */
const requireProjectOwner: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const session = c.get("session");
  if (c.req.param("id") !== session.project_id) {
    return c.json({ error: "Project not found" }, 404);
  }
  if (session.role !== "owner") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
};

/**
 * Owner-only, project-scoped invite + members endpoints. Mounted behind
 * `requireAuth` at `/api/projects`; `requireProjectOwner` gates every route.
 */
export const projectsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  // `requireProjectOwner` matches `/:id/*` (subtree). The bare `/:id` paths
  // (`GET`/`PATCH`) don't match that wildcard on their own, so they're gated
  // explicitly here too.
  .use("/:id", requireProjectOwner)
  .use("/:id/*", requireProjectOwner)
  // Project settings read for Settings → Project (PRD-004 Story 5). Returns the
  // current `allowed_email_domain` plus a count of existing members whose email
  // domain doesn't match it — drives the "they keep access" warning.
  .get("/:id", async (c) => {
    const projectId = c.req.param("id");

    try {
      const project = await c.env.DB.prepare(
        "SELECT id, name, allowed_email_domain FROM projects WHERE id = ?",
      )
        .bind(projectId)
        .first<{ id: string; name: string; allowed_email_domain: string | null }>();
      if (!project) {
        return c.json({ error: "Project not found" }, 404);
      }

      let mismatchedMemberCount = 0;
      if (project.allowed_email_domain) {
        const row = await c.env.DB.prepare(
          `SELECT COUNT(*) AS n
             FROM memberships m
             JOIN users u ON u.id = m.user_id
            WHERE m.project_id = ?
              AND lower(substr(u.email, instr(u.email, '@') + 1)) <> ?`,
        )
          .bind(projectId, project.allowed_email_domain)
          .first<{ n: number }>();
        mismatchedMemberCount = row?.n ?? 0;
      }

      return c.json({
        id: project.id,
        name: project.name,
        allowed_email_domain: project.allowed_email_domain,
        mismatched_member_count: mismatchedMemberCount,
      });
    } catch (err) {
      console.error("DB error in GET /api/projects/:id:", err);
      return c.json({ error: "Database error fetching project" }, 500);
    }
  })
  // Set/clear `allowed_email_domain` (PRD-004 Story 5). Empty string → NULL
  // (clear); a set value must look like a domain and is stored lowercased.
  .patch("/:id", zValidator("json", projectPatchSchema), async (c) => {
    const projectId = c.req.param("id");
    const raw = c.req.valid("json").allowed_email_domain;

    const trimmed = raw?.trim() ?? "";
    const next = trimmed.length === 0 ? null : trimmed.toLowerCase();
    if (next !== null && !isValidDomain(next)) {
      return c.json({ error: "Enter a valid domain like `mohara.co`." }, 400);
    }

    try {
      await c.env.DB.prepare("UPDATE projects SET allowed_email_domain = ? WHERE id = ?")
        .bind(next, projectId)
        .run();
      return c.json({ allowed_email_domain: next });
    } catch (err) {
      console.error("DB error in PATCH /api/projects/:id:", err);
      return c.json({ error: "Database error updating project" }, 500);
    }
  })
  .post("/:id/invites", zValidator("json", inviteCreateSchema), async (c) => {
    const projectId = c.req.param("id");
    const session = c.get("session");
    const { role } = c.req.valid("json");
    const email = c.req.valid("json").email.trim().toLowerCase();

    try {
      // allowed_email_domain gate (PRD-004 Story 5): reject out-of-domain
      // invites while the restriction is active. No row is written.
      const project = await c.env.DB.prepare(
        "SELECT allowed_email_domain FROM projects WHERE id = ?",
      )
        .bind(projectId)
        .first<{ allowed_email_domain: string | null }>();
      if (project?.allowed_email_domain && domainOf(email) !== project.allowed_email_domain) {
        return c.json(
          { error: "Email domain does not match the project's allowed domain." },
          400,
        );
      }

      // Already a member? (join memberships → users by email)
      const member = await c.env.DB.prepare(
        `SELECT u.id FROM users u
           JOIN memberships m ON m.user_id = u.id AND m.project_id = ?
         WHERE lower(u.email) = ?`,
      )
        .bind(projectId, email)
        .first<{ id: string }>();
      if (member) {
        return c.json({ error: "That email is already a member." }, 409);
      }

      // Pending invite already exists?
      const pending = await c.env.DB.prepare(
        "SELECT id FROM invites WHERE project_id = ? AND email = ? AND accepted_at IS NULL",
      )
        .bind(projectId, email)
        .first<{ id: string }>();
      if (pending) {
        return c.json({ error: "An invite for that email is already pending." }, 409);
      }

      const id = generateId("inv");
      const token = randomToken();
      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + INVITE_TTL_SECONDS;

      await c.env.DB.prepare(
        `INSERT INTO invites
           (id, project_id, email, role, token, invited_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, projectId, email, role, token, session.user.id, now, expiresAt)
        .run();

      return c.json(
        {
          token,
          expires_at: expiresAt,
          invite_url: `${c.env.APP_BASE_URL}/invites/${token}`,
        },
        201,
      );
    } catch (err) {
      // Backstop for the SELECT-then-INSERT race on the partial unique index.
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        return c.json({ error: "An invite for that email is already pending." }, 409);
      }
      console.error("DB error in POST /api/projects/:id/invites:", err);
      return c.json({ error: "Database error creating invite" }, 500);
    }
  })
  .get("/:id/invites", async (c) => {
    const projectId = c.req.param("id");

    try {
      const now = Math.floor(Date.now() / 1000);
      const result = await c.env.DB.prepare(
        `SELECT id, email, role, expires_at
         FROM invites
         WHERE project_id = ? AND accepted_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`,
      )
        .bind(projectId, now)
        .all<{ id: string; email: string; role: "owner" | "member"; expires_at: number }>();

      return c.json({ invites: result.results });
    } catch (err) {
      console.error("DB error in GET /api/projects/:id/invites:", err);
      return c.json({ error: "Database error listing invites" }, 500);
    }
  })
  .delete("/:id/invites/:invite_id", async (c) => {
    const projectId = c.req.param("id");
    const inviteId = c.req.param("invite_id");

    try {
      const invite = await c.env.DB.prepare(
        "SELECT id, accepted_at FROM invites WHERE id = ? AND project_id = ?",
      )
        .bind(inviteId, projectId)
        .first<{ id: string; accepted_at: number | null }>();
      if (!invite) {
        return c.json({ error: "Invite not found" }, 404);
      }
      if (invite.accepted_at !== null) {
        return c.json(
          { error: "Cannot revoke an accepted invite. Remove the member instead." },
          400,
        );
      }

      await c.env.DB.prepare("DELETE FROM invites WHERE id = ?").bind(inviteId).run();
      return c.body(null, 204);
    } catch (err) {
      console.error("DB error in DELETE /api/projects/:id/invites/:invite_id:", err);
      return c.json({ error: "Database error revoking invite" }, 500);
    }
  })
  .get("/:id/members", async (c) => {
    const projectId = c.req.param("id");

    try {
      const result = await c.env.DB.prepare(
        `SELECT u.id AS user_id, u.email, u.name, m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.project_id = ?
         ORDER BY u.email ASC`,
      )
        .bind(projectId)
        .all<{ user_id: string; email: string; name: string; role: "owner" | "member" }>();

      return c.json({ members: result.results });
    } catch (err) {
      console.error("DB error in GET /api/projects/:id/members:", err);
      return c.json({ error: "Database error listing members" }, 500);
    }
  })
  // --- Environment grants (PRD-004 Story 4) ---
  // The matrix data for Settings → Environments: every environment in the
  // project (columns) × every member (rows), with the granted env ids per row.
  // Owners are always treated as fully-granted (their rows carry every env id);
  // the UI renders those cells read-only.
  .get("/:id/grants", async (c) => {
    const projectId = c.req.param("id");

    try {
      const envs = await c.env.DB.prepare(
        `SELECT id, slug, name FROM environments
         WHERE project_id = ?
         ORDER BY is_default DESC, slug ASC`,
      )
        .bind(projectId)
        .all<{ id: string; slug: string; name: string }>();

      const members = await c.env.DB.prepare(
        `SELECT u.id AS user_id, u.email, m.role
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.project_id = ?
         ORDER BY u.email ASC`,
      )
        .bind(projectId)
        .all<{ user_id: string; email: string; role: "owner" | "member" }>();

      const grants = await c.env.DB.prepare(
        "SELECT user_id, environment_id FROM environment_grants WHERE project_id = ?",
      )
        .bind(projectId)
        .all<{ user_id: string; environment_id: string }>();

      const allEnvIds = envs.results.map((e) => e.id);
      const grantsByUser = new Map<string, string[]>();
      for (const g of grants.results) {
        const list = grantsByUser.get(g.user_id) ?? [];
        list.push(g.environment_id);
        grantsByUser.set(g.user_id, list);
      }

      const rows = members.results.map((m) => ({
        user_id: m.user_id,
        email: m.email,
        role: m.role,
        // Owners implicitly have every env; members only their granted ids.
        granted_env_ids: m.role === "owner" ? allEnvIds : (grantsByUser.get(m.user_id) ?? []),
      }));

      return c.json({ environments: envs.results, rows });
    } catch (err) {
      console.error("DB error in GET /api/projects/:id/grants:", err);
      return c.json({ error: "Database error listing grants" }, 500);
    }
  })
  .put("/:id/environments/:env_id/grants/:user_id", async (c) => {
    const projectId = c.req.param("id");
    const envId = c.req.param("env_id");
    const userId = c.req.param("user_id");
    const session = c.get("session");

    try {
      // Target must be a member of this project. 404 (not 403) on a stranger.
      const membership = await c.env.DB.prepare(
        "SELECT role FROM memberships WHERE project_id = ? AND user_id = ?",
      )
        .bind(projectId, userId)
        .first<{ role: "owner" | "member" }>();
      if (!membership) {
        return c.json({ error: "Member not found" }, 404);
      }
      if (membership.role === "owner") {
        return c.json({ error: "Owners always have access to all environments." }, 400);
      }

      // Environment must belong to this project.
      const envRow = await c.env.DB.prepare(
        "SELECT id FROM environments WHERE id = ? AND project_id = ?",
      )
        .bind(envId, projectId)
        .first<{ id: string }>();
      if (!envRow) {
        return c.json({ error: "Environment not found" }, 404);
      }

      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO environment_grants
           (project_id, user_id, environment_id, granted_by, granted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id, user_id, environment_id) DO NOTHING`,
      )
        .bind(projectId, userId, envId, session.user.id, now)
        .run();

      return c.body(null, 204);
    } catch (err) {
      console.error("DB error in PUT grants:", err);
      return c.json({ error: "Database error creating grant" }, 500);
    }
  })
  .delete("/:id/environments/:env_id/grants/:user_id", async (c) => {
    const projectId = c.req.param("id");
    const envId = c.req.param("env_id");
    const userId = c.req.param("user_id");

    try {
      await c.env.DB.prepare(
        `DELETE FROM environment_grants
           WHERE project_id = ? AND user_id = ? AND environment_id = ?`,
      )
        .bind(projectId, userId, envId)
        .run();

      return c.body(null, 204);
    } catch (err) {
      console.error("DB error in DELETE grants:", err);
      return c.json({ error: "Database error revoking grant" }, 500);
    }
  });

/**
 * Unauthenticated invite lookup. Mounted BEFORE `requireAuth` so an invitee can
 * preview the invite before signing in.
 * Returns the project + role for a pending non-expired invite; 410 Gone for a
 * missing / expired / already-accepted token (so the SPA shows one message).
 */
export const publicInvitesRoutes = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/:token",
  async (c) => {
    const token = c.req.param("token");

    try {
      const now = Math.floor(Date.now() / 1000);
      const invite = await c.env.DB.prepare(
        `SELECT i.email, i.role, p.name AS project_name
         FROM invites i
         JOIN projects p ON p.id = i.project_id
         WHERE i.token = ? AND i.accepted_at IS NULL AND i.expires_at > ?`,
      )
        .bind(token, now)
        .first<{ email: string; role: "owner" | "member"; project_name: string }>();

      if (!invite) {
        return c.json({ error: "This invite has expired or is no longer valid." }, 410);
      }

      return c.json({
        project_name: invite.project_name,
        email: invite.email,
        role: invite.role,
      });
    } catch (err) {
      console.error("DB error in GET /api/invites/:token:", err);
      return c.json({ error: "Database error fetching invite" }, 500);
    }
  },
);
