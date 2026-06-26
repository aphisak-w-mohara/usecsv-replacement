import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { randomToken } from "../lib/encoding.js";
import { generateId } from "../lib/ids.js";

/** 7 days in seconds — the invite validity window. */
const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

const inviteCreateSchema = z.object({
  email: z.string().min(1).max(320).email(),
  role: z.enum(["owner", "member"]).default("member"),
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
 * `requireSession` at `/api/projects`; `requireProjectOwner` gates every route.
 */
export const projectsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>()
  .use("/:id/*", requireProjectOwner)
  .post("/:id/invites", zValidator("json", inviteCreateSchema), async (c) => {
    const projectId = c.req.param("id");
    const session = c.get("session");
    const { role } = c.req.valid("json");
    const email = c.req.valid("json").email.trim().toLowerCase();

    try {
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
  });

/**
 * Unauthenticated invite lookup. Mounted BEFORE `requireSession` (alongside
 * `/api/auth`) so an invitee can preview the invite before signing in.
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
