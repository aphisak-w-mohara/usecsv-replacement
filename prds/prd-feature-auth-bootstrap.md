# Feature PRD — Auth & Bootstrap

**Trigger:** Use this when you are about to build a specific user flow or feature.
**Output:** A build-ready spec that can be handed directly to AI code generation or a developer.

**ID:** PRD-004
**Type:** Feature
**Parent PRD:** PRD-001 evo-csv
**Author:** Aphisak Naksomboon
**Date:** 2026-05-28
**Status:** Draft — Pending Review
**Target release:** Q3 2026 (TBC)
**Version:** 1.0

## Version history
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-05-28 | Aphisak Naksomboon | Initial draft. |

## 1. Context

Everything in evo-csv assumes a signed-in user with a `project_id`, `environment_id`, and a `role` on `c.var.session`. Today that session is faked by [apps/worker/src/middleware/dev-session.ts](../apps/worker/src/middleware/dev-session.ts), which reads a `DEV_USER_EMAIL` env var and looks up a seeded user in D1. This unblocks local dev for PRD-002 (Upload Wizard) and PRD-003 (Importer CRUD), but it cannot ship — anyone with the URL would be logged in as the dev user.

This feature ships the real **Google SSO + closed-signup** auth model described in [PRD-001 §7.1, §15, §17](./prd-high-evo-csv.md) and detailed in [the design spec §"Authentication — Google SSO"](../docs/superpowers/specs/2026-05-26-usecsv-clone-design.md). It also ships the **CLI bootstrap** that seeds the first owner (since SSO is closed, no one can sign in until a row exists), and the two surfaces that complete the project's org-chart story: **invites** (so an owner can let a new teammate in) and **environment grants** (so a member is scoped to a subset of envs).

The feature replaces the `dev-session.ts` stub completely. After it lands, the only routes that don't require a session are `/login`, `/invites/:token`, `/api/auth/*`, and the static SPA shell.

**Parent PRD:** [PRD-001 evo-csv](./prd-high-evo-csv.md)
**Feature area:** Auth, identity, org chart

## 2. Scope

### What is being built

A real, production-grade auth surface for evo-csv:

- **`pnpm bootstrap`** — a one-shot CLI command that seeds the first owner, project, and default environment in D1. Idempotent on `(project.slug, user.email)`. The only way to create the first user row.
- **Google SSO login** at `/login` — "Continue with Google" button that runs the OAuth Auth-Code + PKCE flow via `@hono/oauth-providers/google`.
- **Closed-signup OAuth callback** with the four branches from PRD-001 §7.1: existing `google_sub` match, existing email match (binds `google_sub`), pending invite match (materializes membership), otherwise 403.
- **Opaque KV-backed sessions** with 14-day rolling expiry, set as an HTTP-only `__Host-` cookie, validated by a `requireSession` middleware that **replaces `dev-session.ts` everywhere it's mounted**.
- **Logout** (`POST /api/auth/logout`) — clears the cookie and deletes the KV session row.
- **Invite create/revoke/accept** — owner-only `POST /api/projects/:id/invites` and `DELETE` on the invite row; invitee accepts at `/invites/:token` which carries the token through OAuth via the `state` param and is matched in the callback.
- **Environment grants** — owner-only `POST/DELETE /api/projects/:id/environments/:env_id/grants` adds/removes a presence-only `(project_id, user_id, environment_id)` row. The env switcher and every env-scoped route check it. Owners are implicitly granted everything (no rows required).
- **`allowed_email_domain` enforcement** — owner can set/clear it on the project settings page; the OAuth callback verifies it against the Google `hd` claim + the email's domain; invite creation blocks non-matching domains while it's active.
- **`/api/me`** — returns `{ user, project, environment, role, accessible_environments[] }` so the SPA can render the env switcher and gate UI.

### What is not being built (out of scope)

- **Magic-link / email-password auth.** Google SSO only for MVP (PRD-001 §15).
- **Project switcher UI.** Single-project at launch (PRD-001 §15); the data model supports it but UI is hidden.
- **Owner-only environment CRUD** (create/delete environments themselves, project rename). Captured by a forthcoming PRD-006 "Owner admin". This PRD ships environment **grants** but not environment **CRUD**.
- **Invite emails via MailChannels.** Out of scope for MVP per PRD-001 §13 — the owner copies the invite link out of the UI and shares it manually.
- **Self-service profile editing** beyond what `/admin/profile` already needs (linked Google account, last-active env). No avatar upload, no name change.
- **2FA / WebAuthn.** Inherited from Google Workspace.
- **Audit log surface in the UI.** Sign-in events are written but not yet rendered.
- **Session revocation by admin** ("force-logout user X"). Possible by deleting their KV rows manually; UI ships later.
- **Account deletion / GDPR right-to-be-forgotten flow.** Internal staff tool, deferred.

**Sign-off:** [ ] Approved by Aphisak Naksomboon on [date]

## 3. Current State vs Desired End State

|  | Description |
|---|---|
| **Current state** | Sessions are faked by [apps/worker/src/middleware/dev-session.ts](../apps/worker/src/middleware/dev-session.ts), which reads `DEV_USER_EMAIL` and looks up the seeded user (`usr_dev` / `aphisak@mohara.co`) in D1. Every API route is mounted behind it. The `users` table already has `google_sub`, `picture_url`, `last_active_project_id`, `last_active_environment_id` columns from [0001_initial.sql](../apps/worker/migrations/0001_initial.sql) but they're unused. No `invites` or `environment_grants` tables exist. No KV binding for sessions. No `/login` or `/invites/:token` pages. No bootstrap CLI. |
| **Desired end state** | A new Mohara teammate runs `pnpm bootstrap --email aphisak@mohara.co --project-slug evo --project-name EVO`, visits the deployed Worker, lands on `/login`, clicks "Continue with Google", and ends up at `/admin/importers` as owner. They invite a junior dev → the junior dev clicks the link → signs in with Google → lands in the project as a member with no env grants. The owner grants them `staging` → the junior dev's env switcher now shows staging. The `dev-session.ts` file is deleted. |

## 4. Permissions Impact

| Role | Can do | Cannot do |
|---|---|---|
| **Owner** | Bootstrap is run *as* them. After login: create/revoke invites, grant/revoke env access for any member, set/clear `allowed_email_domain`, sign in to every environment in the project | — |
| **Member with env grants** | Sign in via SSO (if the email is on a membership or a pending invite), use any environment they have a grant for, log out | Create or revoke invites, grant/revoke env access, change project settings, see envs they have no grant for (the env switcher hides them; direct API calls 404) |
| **Member without env grants** | Sign in. Land on a "No environment access yet — ask a project owner to grant you access." page | Reach any env-scoped surface |
| **Stranger** (unknown email, no pending invite) | Hit `/login` and click "Continue with Google" | Anything past the callback — receives a 403 page, no user row is created (closed-signup) |

## 5. User Stories & Acceptance Criteria

---

### Story 1 — Bootstrap the first owner via CLI

**User story**
As a Mohara operator setting up evo-csv for the first time (or rescuing access after losing it), I want to run a single CLI command that seeds a project, an owner user, and a default environment in D1, so that I can sign in via Google SSO without an open-signup hole.

**Detailed flow**
1. Operator runs `pnpm bootstrap --email aphisak@mohara.co --project-slug evo --project-name EVO` from the repo root. Optional flags: `--allowed-email-domain mohara.co`, `--environment-slug staging` (default `staging`), `--environment-name Staging` (default `Staging`).
2. The script (`tools/bootstrap.ts`) is a thin wrapper around `wrangler d1 execute` that runs one transaction:
   - `INSERT OR IGNORE INTO projects (slug, name, allowed_email_domain)` keyed on `slug`.
   - `INSERT OR IGNORE INTO users (email, name)` keyed on `email`. Preserves any existing `google_sub`.
   - `INSERT OR IGNORE INTO environments (project_id, slug, name, is_default=1)`.
   - `INSERT OR REPLACE INTO memberships (project_id, user_id, role='owner')` — upserts the role to `owner` if a membership already exists.
3. On success the script prints the project id, environment id, user id, and the login URL.
4. Re-running with the same flags is a no-op (no duplicates, no errors). Re-running with `--email <different>@mohara.co` against the same `--project-slug` adds a second owner — useful for disaster recovery.

**Edge cases & error states**
- Missing required flag → exit 1 with usage.
- `--allowed-email-domain mohara.co` set but `--email user@gmail.com` → exit 1 with "Owner email does not match `allowed_email_domain`. Use a matching email or omit the flag."
- D1 binding not configured in `wrangler.toml` → wrangler's own error surfaces; the script doesn't swallow it.
- Running against `--remote` writes to the deployed D1; running against `--local` (default) writes to the local dev D1. The flag passes through.
- Idempotency: re-run upserts the membership role to `owner` (so a previously-demoted user can be promoted by running bootstrap again).

**Acceptance criteria**
1. `pnpm bootstrap --email X --project-slug Y --project-name Z` creates a project, user, default environment, and an owner membership when none exist.
2. Re-running the same command is a no-op — no duplicates, exit 0.
3. Re-running with an existing user already on the project upserts their role to `owner`.
4. `--allowed-email-domain` is stored on the project and rejects mismatched owner emails at CLI time.
5. The script supports both `--local` (default) and `--remote` D1 targets via wrangler.
6. The script prints the IDs and the login URL on success.

**Test cases**
1. Fresh DB + bootstrap → row count: 1 project, 1 user, 1 environment, 1 membership(owner).
2. Re-run identical → row counts unchanged; exit 0.
3. Bootstrap a second email against the same project → 1 project, 2 users, 2 owner memberships.
4. Bootstrap with `--allowed-email-domain mohara.co` and `--email x@gmail.com` → exit 1; no rows written.
5. Bootstrap, then manually `UPDATE memberships SET role='member'`, then re-bootstrap → role back to `owner`.

---

### Story 2 — Sign in with Google (closed-signup) and log out

**User story**
As a Mohara teammate whose membership or invite already exists, I want to sign in with my Google Workspace account and get a session, so that I can use the app; and I want unknown emails to be rejected so the tool isn't open to the internet.

**Detailed flow**
1. Visitor opens any URL → `requireSession` 401s API calls; the SPA's authed layout redirects browser hits to `/login`.
2. `/login` renders a single "Continue with Google" button and (in dev) the version + deployed-commit fingerprint.
3. Click → SPA hits `GET /api/auth/google/login` → Worker generates an OAuth `state` (random 32 bytes) + PKCE verifier, stores `{ state, verifier, return_to, invite_token? }` in KV with a 10-minute TTL, and 302s to Google with the right `client_id`, `redirect_uri`, `scope=openid email profile`, and (per project) `hd=<allowed_email_domain>` hint.
4. Google bounces back to `GET /api/auth/google/callback?code=...&state=...`.
5. Callback validates state, exchanges the code for an `id_token`, parses `{ sub, email, name, picture, hd? }`. Then runs the four-branch gate:
   - **`google_sub` matches a `users` row** → create session, write `last_active_project_id` / `last_active_environment_id` from existing values (or pick the first project + that project's default env if null).
   - **`email` matches a `users` row but `google_sub` is null** (bootstrapped user signing in for the first time, or invite-materialized user) → bind `google_sub`, create session.
   - **No user, but a pending non-expired `invites` row matches `email` AND the callback was initiated with that invite's `token` in `state.invite_token`** → create `users` row (with `google_sub`), create `memberships` row at the invite's role, mark invite `accepted_at`, create session.
   - **None of the above** → 403 page "Not authorized. Ask a project owner for an invite." **No `users` row is created.**
6. Session cookie is HTTP-only, `Secure`, `SameSite=Lax`, `__Host-evocsv-session=<opaque-token>`, 14-day expiry. KV row at `session:<token>` holds `{ user_id, project_id, environment_id, role, expires_at }` with a 14-day TTL that is bumped on every authenticated request (rolling).
7. After session creation, redirect to `state.return_to` if present, else `/admin/importers`.
8. `POST /api/auth/logout` deletes the KV row, clears the cookie, returns 204. The SPA navigates to `/login`.
9. `requireSession` middleware: reads the cookie → KV lookup → 401 if missing/expired → sets `c.var.session` with the KV row's fields → bumps the KV TTL.
10. The dev-only `dev-session.ts` middleware is **deleted** from the worker entry; all routes now sit behind `requireSession`. The `DEV_USER_EMAIL` env var is removed from `wrangler.toml`.

**Edge cases & error states**
- State mismatch / expired (>10 min) → 400 "Login expired, please try again." Returns to `/login`.
- Google returns no `email` claim (verified=false) → 403.
- `hd` hint was sent but Google's `hd` claim is missing or mismatches → 403 "Your Google account is not on the allowed workspace." (Story 5 covers the project-level enforcement.)
- KV write fails → 503 "Sign-in temporarily unavailable, please retry."
- Invite token in `state` but the invite is expired or already accepted → fall through to the "otherwise" branch → 403.
- A logged-in user hitting `/login` is redirected to `/admin/importers` instead of re-doing OAuth.
- Concurrent sign-in from two browsers creates two valid sessions (one per cookie). No global session limit for MVP.
- Cookie name uses the `__Host-` prefix → requires HTTPS in any non-localhost env; the local dev server is exempt via `Secure=false` only when `c.env.ENVIRONMENT === 'local'`.

**Acceptance criteria**
1. A user whose `users.google_sub` already matches the Google token can sign in and lands at `/admin/importers` (or `return_to`).
2. A bootstrapped user (email match, no `google_sub` yet) signs in successfully and their `google_sub` is bound on first login.
3. A user with no record and no pending invite is rejected with a 403 page; no `users` row is created.
4. A user holding a valid invite link signs in through that flow; the membership is materialized at the invite's role and the invite is marked accepted.
5. `requireSession` 401s every authenticated API route when the cookie is missing or expired.
6. `POST /api/auth/logout` clears the cookie, deletes the KV session, returns 204, and a follow-up authenticated call 401s.
7. The session cookie is HTTP-only, `Secure` (except in `local`), `SameSite=Lax`, and uses the `__Host-` prefix in non-local envs.
8. KV session TTL refreshes on each authenticated request (rolling 14-day window).
9. The `dev-session.ts` file and `DEV_USER_EMAIL` config are removed; CI fails if either reappears.

**Test cases**
1. Bootstrap `aphisak@mohara.co` → sign in with that Google account → session cookie set → `GET /api/me` returns the owner role.
2. After step 1, `users.google_sub` is non-null and matches the Google subject.
3. Sign in with `stranger@example.com` (no membership, no invite) → 403; `users` row count unchanged.
4. After signing in, `POST /api/auth/logout` → 204; subsequent `GET /api/me` → 401.
5. Tamper with the cookie value → 401 (KV miss).
6. Wait until KV TTL would have expired (mock clock), call `GET /api/me` → 401.
7. With one valid session, call any authenticated endpoint → KV TTL is bumped (assert via mocked clock or KV inspector).
8. Grep the repo for `DEV_USER_EMAIL` / `dev-session.ts` → no matches in worker src.

---

### Story 3 — Owner invites a member; member accepts and lands in the project

**User story**
As an owner, I want to invite a teammate by email and copy a one-time link out of the UI, so that they can sign in via Google SSO and become a member of the project at the role I chose.

**Detailed flow**
1. New migration creates the `invites` table: `id, project_id, email (lowercased), role ('owner'|'member'), token (random 32-byte url-safe), invited_by (user_id), created_at, expires_at (created_at + 7 days), accepted_at (nullable)`. `UNIQUE(project_id, email) WHERE accepted_at IS NULL`.
2. Owner opens `/admin/settings` → **Members** section → existing members are listed (read-only for now); pending invites are listed underneath; **+ Invite member** form has email + role dropdown (owner / member, default member).
3. Owner submits → `POST /api/projects/:id/invites` writes the row and returns `{ token, expires_at, invite_url: "<origin>/invites/<token>" }`. The UI shows the URL in a copy-to-clipboard field with a "Send this link manually to <email>." note.
4. Pending invites can be revoked (`DELETE /api/projects/:id/invites/:invite_id`) → row deleted, link no longer works.
5. Invitee visits `/invites/<token>` (unauthenticated): the SPA validates the token via `GET /api/invites/<token>` (returns `{ project_name, email, role }` for non-expired non-accepted invites; 410 Gone otherwise). The page shows "<owner name> invited you to <project name> as <role>." with a "Continue with Google" button.
6. Click → SPA calls `GET /api/auth/google/login?invite_token=<token>` → Worker stores the token in the same KV state row used by Story 2; OAuth callback's "pending invite" branch (Story 2, step 5c) materializes the membership and marks `accepted_at`. The invitee lands at `/admin/importers` as a member.
7. If the invitee's Google email does not match the invite's email → 403 "This invite was issued to <invite.email>. Sign in with that account or ask for a new invite."

**Edge cases & error states**
- Duplicate pending invite for same `(project_id, email)` → 409 "An invite for that email is already pending." Owner can revoke and re-create.
- Inviting an email that is already a member → 409 "That email is already a member."
- Invite token expired (>7 days) → `GET /api/invites/<token>` returns 410; `/invites/<token>` page shows "This invite has expired. Ask the project owner for a new one."
- Already-accepted invite → 410 (same UI).
- Revoking an invite that was already accepted → 400 "Cannot revoke an accepted invite. Remove the member instead." (member removal lands in PRD-006.)
- Invite role is captured at create time and is immutable. To change the intended role, revoke and re-invite.
- Non-owner calling any invite endpoint → 403.

**Acceptance criteria**
1. Owner can create an invite with email + role; UI shows the resulting `/invites/<token>` URL to copy.
2. Owner can revoke a pending invite; the URL stops working.
3. Visiting `/invites/<token>` shows the project + role; clicking through and signing in with the matching Google email materializes the membership at the invited role.
4. Visiting an expired or already-accepted invite shows a clear 410 message.
5. Signing in with a Google email that doesn't match the invite returns 403 and creates no rows.
6. Non-owner cannot create or revoke invites (403).
7. Re-inviting the same `(project, email)` while a pending invite exists returns 409.

**Test cases**
1. Owner POSTs an invite for `junior@mohara.co` → row exists, response has the URL.
2. Junior clicks the URL, signs in with `junior@mohara.co` → `users` row created, `memberships(project, junior, 'member')` exists, `invites.accepted_at` is non-null.
3. Junior signs in again later (no token) → still works (now they're a normal member); no double-row written.
4. Owner re-invites the same email while step 1's invite is pending → 409.
5. Owner revokes step 1, then re-invites → succeeds, new token, old token returns 410.
6. Junior clicks the link but signs in with `senior@mohara.co` instead → 403; no `users` row for `senior`.
7. Member (not owner) tries to POST invite → 403.
8. Invite TTL: manually set `created_at` to 8 days ago, GET → 410.

---

### Story 4 — Owner grants/revokes environment access for a member

**User story**
As an owner, I want to control which environments each member can see and upload to, so that a junior dev can run staging imports without being one slip away from a production dispatch.

**Detailed flow**
1. New migration creates `environment_grants(project_id, user_id, environment_id, granted_by, granted_at)` with PK `(project_id, user_id, environment_id)` and FKs to all three. **Owners are not required to have rows here** — they always have access; the table only matters for `member` rows.
2. Owner opens `/admin/settings` → **Environments** section → a matrix renders rows = members, columns = environments in this project. A cell is a checkbox: checked = grant exists, unchecked = no grant. Owner rows are read-only (all checked, faded, with a "Owner" tooltip).
3. Toggling a checkbox immediately PUTs/DELETEs `/api/projects/:id/environments/:env_id/grants/:user_id`. Optimistic UI; on error, the cell reverts and a toast surfaces.
4. The env switcher (top nav, currently a placeholder) calls `GET /api/me` and renders only:
   - For owners: every environment in the project.
   - For members: only environments where a grant exists.
5. If a member's last-active environment is removed (grant revoked while they're signed in), the next request to any env-scoped route returns 404 and the SPA forces them through the env switcher to pick a new one. If they have *no* grants left, they land on a "No environment access — ask an owner to grant you access." page.
6. Every env-scoped API route (uploads, importer_environments, etc.) adds a `withEnvironment` middleware that:
   - For owners → no extra check.
   - For members → confirms a grant row exists for `(session.project_id, session.user_id, session.environment_id)`. Missing → 404, **not 403**, to avoid leaking environment existence (matches PRD-002 §4 IDOR pattern).

**Edge cases & error states**
- Toggling a grant on an owner (which is read-only): the API endpoint returns 400 "Owners always have access to all environments." UI shouldn't allow it but the server enforces.
- Trying to grant/revoke a user who isn't a member of the project → 404.
- Trying to grant an environment that isn't in this project → 404.
- Non-owner calling any grants endpoint → 403.
- Revoking your own (owner's) access is impossible because owner grants aren't materialized; a former owner who's been demoted (PRD-006, not this PRD) would then need explicit grants.
- The matrix renders pending invitees as rows too, with their checkboxes disabled and a "Pending invite" tooltip — clicking does nothing. Grants are applied at invite-acceptance time only if they were configured for an existing user; pending-invite grants are deferred to PRD-006.

**Acceptance criteria**
1. Owner can grant a member access to an environment, which immediately enables that environment in the member's env switcher.
2. Owner can revoke a member's access; the member's switcher hides that env on next load, and any direct API request scoped to it returns 404.
3. Owners always have access to every environment without explicit rows.
4. Members with no grants land on a "No environment access" page after sign-in and cannot reach `/admin/importers`.
5. Non-owners cannot read or modify the grants matrix (403).
6. Direct API requests against an environment a member lacks a grant for return **404, not 403**.

**Test cases**
1. Owner grants junior `staging` → `environment_grants` row exists; junior's `GET /api/me` lists `staging` in `accessible_environments`.
2. Junior switches to `staging` → all env-scoped routes work.
3. Owner revokes the grant → junior's next `GET /api/me` no longer lists `staging`; direct `GET /api/importers` while session is on `staging` → 404.
4. Junior switches their session to `production` (no grant) directly via the API → 404.
5. Owner has no grant rows but every env is accessible to them.
6. Non-owner tries to POST a grant → 403.

---

### Story 5 — Project `allowed_email_domain` enforcement

**User story**
As an owner, I want to lock the project to a Google Workspace domain (e.g. `mohara.co`), so that a stolen invite link can't be redeemed by a Gmail account and the OAuth `hd` claim is verified at sign-in.

**Detailed flow**
1. `/admin/settings` → **Project** section → a single text field "Restrict sign-in to Google Workspace domain (optional)" with **Save** and **Clear** buttons. Owner-only.
2. Saving PATCHes `/api/projects/:id` with `{ allowed_email_domain }`. Empty string clears it.
3. From the moment the value is set:
   - The OAuth login route includes `hd=<domain>` in the Google redirect.
   - The OAuth callback verifies BOTH the `hd` claim on the ID token equals the saved value AND the email's domain part equals it. Either failing → 403 "Your Google account is not on the allowed workspace."
   - Invite creation (`POST /api/projects/:id/invites`) rejects emails whose domain part doesn't match the saved value with 400 "Email domain does not match the project's allowed domain."
4. Existing members whose email domain doesn't match the new value are **not** kicked — the field gates new sign-ins and new invites only. The settings page shows a warning if the value is set and any existing membership has a mismatched email: "<n> existing member(s) have a different email domain. They keep access; only new sign-ins and invites are restricted."
5. Clearing the value removes all three enforcement points immediately.

**Edge cases & error states**
- Setting a value that no current member matches → save succeeds, with the warning above.
- Setting an invalid domain (no dot, illegal chars) → 400 "Enter a valid domain like `mohara.co`."
- A pending invite whose email no longer matches the restriction → still acceptable through the OAuth flow (server check runs against the saved restriction *at sign-in time*, not at invite time). This is a known trade-off: revoke the invite to enforce immediately.
- Non-owner attempts to PATCH → 403.

**Acceptance criteria**
1. Owner can set, edit, and clear `allowed_email_domain` from the settings page.
2. When set, the OAuth callback rejects users whose `hd` claim or email domain doesn't match (403, no user row).
3. When set, invite creation rejects emails outside the domain (400, no row).
4. When set, existing members with mismatching email domains keep access and a warning appears in settings.
5. Clearing the value removes all three enforcement points and the warning.
6. Non-owners cannot change the value (403).

**Test cases**
1. Owner sets `allowed_email_domain = mohara.co` → `projects.allowed_email_domain` is `"mohara.co"`; OAuth redirect URL includes `hd=mohara.co`.
2. Stranger signs in with `x@gmail.com` (no invite, no `hd` match) → 403; no user row.
3. Owner invites `y@gmail.com` while restriction is active → 400; no invite row.
4. Pre-existing `legacy@otherco.com` member with the restriction set → can still sign in (it gates new sign-ins / invites, not existing members; settings page shows the warning).
5. Owner clears the value → invite to `y@gmail.com` now succeeds; OAuth redirect drops `hd`.

---

## 6. UI / UX Requirements

- **`/login`** — centered card with the app logo, a single "Continue with Google" button (Google's brand-compliant icon + "Sign in with Google" text). Below the button, a small "Need access? Ask a project owner for an invite." line. Loading state: button shows a spinner; on error from `?error=` query param (e.g. `unknown_email`, `expired_state`, `domain_mismatch`) display the matching message above the button.
- **`/invites/:token`** — same card chrome as `/login`. Title: "<owner name> invited you to <project name> as <role>." Body line: "Sign in with the Google account that owns <email> to accept." Same Google button. Expired/accepted token renders an error card: "This invite is no longer valid. Ask <project name> for a new one."
- **403 page** (`/login?error=unknown_email` etc.) — clear copy ("Not authorized. evo-csv is invite-only — ask a project owner for an invite."), a single "Try a different Google account" link that runs OAuth again.
- **No-env page** — when a member signs in with zero env grants: card titled "No environment access yet." Body: "Ask a project owner to grant you access to an environment to start using evo-csv." Sign-out link.
- **Env switcher** (top nav) — populated from `accessible_environments` on `/api/me`. For owners shows all envs; for members shows only granted ones. Disabled state with tooltip "Ask an owner to grant you access" when accessible_environments is empty.
- **Settings → Members** — table of members (avatar + name + email + role), pending invites listed below with role + expires-at + Revoke. "+ Invite member" opens a modal with email + role; on submit, the modal switches to "Copy this link and send it to <email>" with a single textarea + copy button + Done.
- **Settings → Environments** — grants matrix (rows = members, columns = envs). Owner rows are checked + disabled + tooltipped "Owner — always has access." Pending invitees are listed with disabled cells + "Pending invite" tooltip.
- **Settings → Project** — name (rename out of scope here), `allowed_email_domain` text field + Save/Clear. Warning banner when set + existing member emails don't all match.

## 7. Data & Schema Changes

- **New tables:**
  - `invites (id PK, project_id FK, email TEXT NOT NULL, role TEXT CHECK ('owner','member'), token TEXT UNIQUE NOT NULL, invited_by FK users, created_at INT, expires_at INT, accepted_at INT NULL)`. `UNIQUE(project_id, lower(email)) WHERE accepted_at IS NULL`.
  - `environment_grants (project_id, user_id, environment_id, granted_by FK users, granted_at INT, PRIMARY KEY (project_id, user_id, environment_id))`.
- **Modified fields:** none — `users.google_sub`, `users.last_active_project_id`, `users.last_active_environment_id` already exist from [0001_initial.sql](../apps/worker/migrations/0001_initial.sql) and are now actually written.
- **New KV bindings:** `SESSIONS` (key prefix `session:<token>`, 14-day rolling TTL) and `OAUTH_STATE` (key prefix `oauth:<state>`, 10-minute TTL).
- **New Wrangler secrets:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SESSION_COOKIE_SECRET` (used to derive the opaque session token).
- **Removed config:** `DEV_USER_EMAIL` env var; the `dev-session.ts` middleware.
- **New endpoints:**
  - `GET /api/auth/google/login` (302 to Google; accepts optional `invite_token` + `return_to`)
  - `GET /api/auth/google/callback` (exchanges + four-branch gate + sets cookie)
  - `POST /api/auth/logout` (204)
  - `GET /api/me` (session + accessible_environments)
  - `GET /api/invites/:token` (unauthed; 200 with project_name/email/role, or 410)
  - `POST /api/projects/:id/invites` (owner-only)
  - `DELETE /api/projects/:id/invites/:invite_id` (owner-only)
  - `PUT /api/projects/:id/environments/:env_id/grants/:user_id` (owner-only)
  - `DELETE /api/projects/:id/environments/:env_id/grants/:user_id` (owner-only)
  - `PATCH /api/projects/:id` (owner-only; covers `allowed_email_domain`)
- **Modified endpoints:** every existing route mounted under `requireSession` instead of `devSession`. `withEnvironment` middleware added to env-scoped routes (importer_environments, uploads, batches).
- **New CLI entry point:** `tools/bootstrap.ts` exposed via the root `package.json` script `pnpm bootstrap`.

## 8. Technical Notes

- **OAuth library**: `@hono/oauth-providers/google`. It supports PKCE and `hd` hint natively. Confirm it exposes the `id_token` claims so we can read `hd` directly (the spec says yes; verify on first spike).
- **State storage**: keep the 10-min OAuth state in KV, not in a cookie. The flow needs to survive a non-same-site redirect from Google, and storing it server-side is simpler than cookie-state-with-Set-Cookie-on-the-redirect.
- **Cookie naming**: use `__Host-evocsv-session` in non-local envs. The `__Host-` prefix requires `Secure; Path=/; (no Domain)`, which is exactly what we want and is enforced by browsers. In local dev, fall back to `evocsv-session` without `Secure`.
- **Session opacity**: the cookie value is the random opaque token; all session state lives in KV. No JWTs, no claims in the cookie, no signing on the client side. Revocation = delete the KV row.
- **Rolling TTL**: bump KV TTL on every authenticated request. Cloudflare KV's TTL is set on `put`; reads need to re-write the row with the same value + new TTL. Acceptable cost.
- **`dev-session.ts` removal**: this PR deletes [apps/worker/src/middleware/dev-session.ts](../apps/worker/src/middleware/dev-session.ts) and replaces every `app.use(devSession)` call site with `app.use(requireSession)`. The `inject-user-id` middleware ([apps/worker/src/lib/inject-user-id.ts](../apps/worker/src/lib/inject-user-id.ts)) is unaffected — it reads from `c.var.session` which both middlewares set with the same shape.
- **Tests today** that depend on `DEV_USER_EMAIL` (see [apps/worker/test/dev-session.test.ts](../apps/worker/test/dev-session.test.ts)) need to be rewritten to seed a session token in KV directly and set the cookie. A small `testSession(env, { email, role, project, env })` test helper is the right level of abstraction.
- **Worker bindings**: `wrangler.toml` gains two KV namespaces. The CI/dev story for KV namespaces is `wrangler kv:namespace create` once per environment, then paste the id back into `wrangler.toml`. Capture in the README.
- **Closed-signup test**: write an integration test that drives the OAuth callback with a fixture id_token whose email is unknown and no invite exists → asserts 403 AND `SELECT count(*) FROM users` is unchanged. This is the most important regression test in the feature.
- **`hd` claim parsing**: Google sends `hd` for Workspace accounts only. A `gmail.com` account has no `hd` claim. The check is: if `allowed_email_domain` is set, require `id_token.hd === allowed_email_domain` AND `email.endsWith("@" + allowed_email_domain)`. Both — because in theory a Workspace can have a user whose primary email is on a different domain.
- **OAuth redirect URI**: configured in Google Cloud Console once per environment. For MVP that's `https://evo-csv.<account>.workers.dev/api/auth/google/callback`. Local dev uses `http://localhost:5173/api/auth/google/callback` (Vite dev server proxies to the worker dev server).
- **Invite token entropy**: 32 random bytes, base64url-encoded → 43 chars. Generated server-side with `crypto.getRandomValues`. Never logged.

## 9. Platform-Specific Rules

Web only. No mobile considerations. Accessibility: `/login` and `/invites/:token` must be keyboard-navigable, the Google button must have an accessible label, and error messages must be associated with the relevant focusable region via `aria-describedby`. Match Google's brand guidelines for the sign-in button.

## 10. Linked Issues / PRDs

- Parent: [PRD-001 evo-csv](./prd-high-evo-csv.md)
- Sibling features that depend on this: [PRD-002 Upload Wizard](./prd-feature-upload-wizard.md) (currently shipped behind `dev-session.ts`), [PRD-003 Importer CRUD + Per-Env Config](./prd-feature-importer-crud-config.md).
- Forthcoming siblings under PRD-001 referenced by the index: **Webhook dispatch pipeline** (queue consumer + retry/halt).
- Likely successor: **PRD-006 Owner admin** — environment CRUD, member removal, role change, pending-invite env grants pre-staging. Not in this PRD.
- Related code: [apps/worker/src/middleware/dev-session.ts](../apps/worker/src/middleware/dev-session.ts) (deleted by this feature), [apps/worker/migrations/0001_initial.sql](../apps/worker/migrations/0001_initial.sql) (users/memberships/environments already in place).
- Design spec reference: [docs/superpowers/specs/2026-05-26-usecsv-clone-design.md](../docs/superpowers/specs/2026-05-26-usecsv-clone-design.md) — sections "Authentication — Google SSO" and "Bootstrap".
