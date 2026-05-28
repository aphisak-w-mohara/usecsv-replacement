# Feature PRD — Importer CRUD + Per-Environment Config

**Trigger:** Use this when you are about to build a specific user flow or feature.
**Output:** A build-ready spec that can be handed directly to AI code generation or a developer.

**ID:** PRD-003
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
| 1.0 | 2026-05-28 | Aphisak Naksomboon | Initial draft. Story 1 (importer list + create) already shipped via GH issue #14 / PR #20; included here for completeness of the feature description. |

## 1. Context

The Upload Wizard (PRD-002) assumes importers and their column schemas already exist. Today they are seeded only by SQL migrations (the Tenants importer in [apps/worker/migrations/0002_seed_tenants_columns.sql](../apps/worker/migrations/0002_seed_tenants_columns.sql)), and the per-environment delivery rows are inserted by the same migrations. There is no in-app way to add a Properties importer, rename Tenants, edit its column list, point staging at a new webhook URL, or rotate a leaked HMAC secret. Every change requires a developer to hand-write SQL and a deploy.

This feature is the **admin surface** that lets a member do all of that from the app — the Importers list (the default sidebar landing page) and the tabbed importer detail editor (`General · Columns · {one tab per env}`). It is the second-largest user-facing surface after the wizard and unblocks the "junior dev runs their first import in under 10 minutes" goal from PRD-001 §4 because the dev no longer needs SQL access to set things up.

This PRD covers the **SPA + API admin surface only**. The actual webhook *signing* of dispatched payloads lives in the separate dispatch pipeline (PRD-004, forthcoming) — this feature just stores the toggle and the secret. The upload flow itself remains in PRD-002.

**Parent PRD:** [PRD-001 evo-csv](./prd-high-evo-csv.md)
**Feature area:** Admin / importer configuration

## 2. Scope

### What is being built

A logged-in member opens `/admin/importers` and sees every non-archived importer in the active project with column and env counts. They can create a new importer with a project-unique name and land in its detail page on the Columns tab. The detail page is a tabbed editor:

- **General** — rename the importer, archive/unarchive it.
- **Columns** — add, edit, remove, reorder columns. Each column carries the fields that drive fuzzy matching and per-cell validation in the wizard (machine `name`, display name, description, example, required flag, non-blank flag, validation type + format, custom error message).
- **One tab per environment the member has access to** — webhook URL, batch size, filter toggles, the read-only public `key` UUID, and the signing/secret/key-rotation controls.

Everything is project- and env-scoped from session context. Cross-project access returns 404, never 403, matching the IDOR-resistance pattern set in PRD-002. Webhook secrets are write-once / read-never via the API.

### What is not being built (out of scope)

- **Webhook dispatch / signing logic.** Storing the toggle + secret is in scope; doing the HMAC over outbound POST bodies lives in PRD-004.
- **Owner-only environment CRUD** — creating/deleting environments themselves, project rename, allowed-domain config, member invites, env grants. Those are PRD-005 (Owner admin, forthcoming).
- **Bulk column import** (paste a CSV of column definitions). Each column is added individually.
- **Importer versioning / history.** Edits overwrite; historical uploads carry their own snapshot of `matched_columns_map` and are unaffected.
- **Hard delete of importers.** Archive only — preserves the upload audit trail.
- **Per-environment column overrides.** Schema is project-level by PRD-001 §9.

**Sign-off:** [ ] Approved by Aphisak Naksomboon on [date]

## 3. Current State vs Desired End State

|  | Description |
|---|---|
| **Current state** | Importers and their columns are seeded via SQL migrations only. The Tenants importer + 3 columns + 1 staging environment row exist from [0001_initial.sql](../apps/worker/migrations/0001_initial.sql) / [0002_seed_tenants_columns.sql](../apps/worker/migrations/0002_seed_tenants_columns.sql). The web app has an Importers list and a "Create importer" form (shipped in #14) but the importer detail page is a stub ("Columns editor coming soon. This importer has no columns yet."). Renaming, archiving, column changes, webhook URL changes, and secret rotation all require a developer with SQL access. |
| **Desired end state** | A member opens the Importers list, creates "Properties", adds 13 columns, switches to the "Production" tab, enters Laravel's webhook URL, toggles HMAC signing on, copies the one-time-shown secret into Laravel's env, and uploads a test CSV — all in the browser. The seeded Tenants importer is editable through the same UI. No SQL required. |

## 4. Permissions Impact

| Role | Can do | Cannot do |
|---|---|---|
| **Owner** | Everything in this feature, in every environment | — |
| **Member with env access** | Read + write everything below for an importer (column edits affect all envs); read + write env config only for envs they have a grant for | Read or write config for envs they don't have a grant for — direct API call returns 404 to avoid leaking env existence (matches PRD-002 §4) |
| **Member without env access** | Reach `/admin/importers` and see the project's importers (membership-gated, not env-gated). They can also read columns. | Edit anything if no env grant exists at all (covered by `requireSession`); see env tabs they don't have a grant for; create env config. |

Column edits are intentionally project-level (PRD-001 §9, business rule "Importer column schemas are project-level"). The Columns tab carries a persistent banner reminding the member that changes affect all environments including production.

## 5. User Stories & Acceptance Criteria

---

### Story 1 — Importer list + create  *(shipped — issue #14, PR #20)*

**User story**
As a member with env access, I want to see all importers in the project and create a new one, so that I can set up a new CSV schema for a client onboarding.

**Detailed flow**
1. Member opens `/admin/importers` (the sidebar default).
2. The list renders all non-archived importers in the active project with name, column count, env count, and `updated_at`. Empty state shows a "Create your first importer" CTA.
3. Member clicks **+ New importer**, types a project-unique name, hits create.
4. App POSTs to the worker, gets back the importer id, redirects to `/admin/importers/<id>` on the Columns tab (which is the empty-state column editor for now).
5. A **Show archived** toggle includes archived importers in the list.

**Edge cases & error states**
- Duplicate name (case-insensitive) within the project → 409 with inline "An importer with this name already exists."
- Empty/whitespace-only name → blocked client-side; server also rejects with 400.
- Cross-project access to `/admin/importers` itself is impossible since the session pins `project_id`.

**Acceptance criteria**
1. Member sees all non-archived importers in the current project (name, # columns, # configured envs, last updated), never importers from another project.
2. Member can create an importer with a project-unique name and is taken straight to its editor on the Columns tab (empty state).
3. Archived importers are hidden by default and shown via a "Show archived" toggle.
4. Duplicate importer name within the project returns 409 with inline error.
5. Empty/whitespace-only name is blocked client-side.

**Test cases**
1. Create "Properties" → row exists with `project_id = session.project_id`, `archived_at IS NULL`.
2. Create "tenants" while "Tenants" exists → 409.
3. List with `?include_archived=true` includes archived rows; without it, doesn't.
4. Forge `project_id` in request body → ignored; row created in session's project.

---

### Story 2 — Importer general settings (rename / archive)  *(open — issue #15)*

**User story**
As a member, I want to rename or archive an importer, so that I can keep the importer list tidy and correct.

**Detailed flow**
1. Member opens an importer detail page → switches to the **General** tab.
2. Editable name field with **Save**; renaming PATCHes the worker and refreshes the page header.
3. **Archive** button opens a confirm dialog: "Archiving hides this importer from the list and prevents new uploads against it. Historical uploads remain viewable. You can unarchive later."
4. On confirm, `archived_at` is stamped, the page redirects to `/admin/importers` with a "Importer archived" toast.
5. Archived importers in the list (visible only with **Show archived**) show an **Unarchive** action that clears `archived_at`.

**Edge cases & error states**
- Renaming to a colliding name (case-insensitive, project-scoped) → 409 inline "An importer with this name already exists."
- Empty/whitespace-only name → 400.
- Archiving an already-archived importer is a no-op (idempotent).
- An archived importer must not appear as an upload target. The upload wizard route guards on `archived_at IS NULL`.

**Acceptance criteria**
1. Renaming updates the name and `updated_at`; a colliding name returns 409.
2. Archiving sets `archived_at`, removes the importer from the default list, and prevents it appearing as an upload target. A confirm dialog warns before archiving.
3. Unarchiving clears `archived_at`.
4. The General tab surfaces a note that historical uploads remain viewable after archiving.

**Test cases**
1. PATCH `{ name: "Tenants v2" }` → row's name updates; `updated_at` bumps.
2. PATCH `{ archived: true }` → `archived_at` is non-null; the importer disappears from `GET /api/importers` and from the upload-wizard route resolution (existing wizard route should 404 on archived).
3. PATCH `{ archived: false }` → `archived_at` cleared.
4. PATCH on an importer in another project → 404.

---

### Story 3 — Column add / edit / remove  *(open — issue #16)*

**User story**
As a member, I want to add, edit, and remove columns on an importer, so that the upload wizard matches and validates the right fields.

**Detailed flow**
1. Member opens the **Columns** tab. Renders the existing columns in `position` order. A persistent yellow banner reads: "Column changes apply across all environments, including production."
2. **+ Add column** opens a modal with: machine `name` (snake_case, immutable once set is *not* required by AC — name can be edited but the implications are surfaced; see "Edge cases"), display name, description, example, required toggle, non-blank toggle, validation type (dropdown of the 8 usecsv types — string, email, phone, number, date, regex, select, boolean), validation format (free text when applicable: e.g. the date-format preset, regex pattern, comma-separated select options, comma-separated boolean templates), custom error message.
3. New columns are saved with `position = max(position) + 1` — they appear at the end of the list.
4. Inline edit: clicking a row opens the same modal pre-filled. Save PATCHes only the changed fields.
5. **Remove** opens a confirm dialog: "Remove the `<name>` column? Historical uploads keep their snapshot."

**Edge cases & error states**
- Duplicate machine `name` within the importer → 409 (DB enforces `UNIQUE(importer_id, name)`), surfaced inline as "Another column already uses this name."
- `name` not matching `^[a-z][a-z0-9_]*$` → 400 client + server; the wizard relies on these being valid JSON keys.
- Removing the last required column is allowed (an importer with zero required columns is unusable but not corrupt — the wizard's "0 of 0 required matched" state is acceptable empty-config).
- Editing a `name` while uploads exist: existing uploads carry their own `matched_columns_map` snapshot and are unaffected, but new uploads will use the new key — the modal surfaces this with a one-line "Renaming changes the JSON key sent to your webhook. Existing uploads are unaffected." note.

**Acceptance criteria**
1. Member can add a column with all fields listed in flow step 2. It appears at the end of the order.
2. Member can edit any field of an existing column.
3. Member can remove a column.
4. Duplicate machine `name` within the importer returns 409, shown inline.
5. `name` not matching `^[a-z][a-z0-9_]*$` is blocked client + server side.
6. A persistent banner reminds the member that column edits are project-level and affect production.

**Test cases**
1. Add `email_2` (string, optional) → row appears at the end; `position` is `max + 1`.
2. Add `email` while it exists → 409.
3. Add `Email` (capitalized) → 400 (name regex).
4. Edit existing seeded `first_name` to `firstName` → 400.
5. Edit `last_name` description → only that column row is updated; `updated_at` on the importer bumps.
6. Remove a column that was used in an old upload → row is gone, the old upload's `matched_columns_map` still has the original key (read-only fixture, not joined live).

---

### Story 4 — Column reorder  *(open — issue #17)*

**User story**
As a member, I want to reorder an importer's columns, so that the schema presents fields in a sensible order.

**Detailed flow**
1. On the Columns tab, each column row has a drag handle on the left.
2. Drag-and-drop reorders the visible list optimistically.
3. On drop, the new ordering is PUT to the worker as `{ ordered_ids: [...] }` — the server rewrites all `position` values to match the new sequence (1, 2, 3, …) inside a transaction.
4. Keyboard fallback: each row has up/down arrow buttons that swap adjacent positions; same endpoint, same transaction.
5. Reloading the page shows the new order.

**Edge cases & error states**
- The server PUT rejects an `ordered_ids` array that doesn't match the importer's column id set exactly (missing or extra ids) → 400 "Order list does not match the importer's columns."
- Concurrent reorders from two tabs: last write wins. Acceptable for an internal tool.
- The `UNIQUE(importer_id, position)` constraint requires care — the transaction writes negative temp positions first (e.g. `-1, -2, -3`), then the final 1..N, to avoid mid-transaction collisions.

**Acceptance criteria**
1. Member can reorder columns via drag-and-drop; the new `position` order persists.
2. A keyboard fallback (up/down buttons) reorders columns without a mouse.
3. Reordering then reloading the page preserves the new order.

**Test cases**
1. Drag column 3 to position 1 → next GET returns columns in [3, 1, 2, 4, …].
2. Keyboard "up" on column 2 → swaps to [2, 1, 3, …].
3. PUT with a missing id → 400; no positions change.
4. PUT with the same ids in the same order → no-op; rows untouched.

---

### Story 5 — Per-environment delivery config  *(open — issue #18)*

**User story**
As a member with access to an environment, I want to set that environment's webhook URL and delivery options, so that uploads run against the right backend.

**Detailed flow**
1. The importer detail page shows one tab per environment the member has a grant for (owners see all). An unconfigured env tab shows an empty state: "Configure this environment to enable uploads."
2. The form: webhook URL (text, validated for http/https), batch size (number, default 1000, range 1–50000), `filter_invalid_rows` toggle (default off), `include_unmatched_columns` toggle (default off).
3. **Save** PUTs to the worker. First save inserts the row with a server-generated public `key` UUID; subsequent saves update only the fields. The `key` UUID is shown read-only with a copy-to-clipboard button next to it.
4. A separate **Signing** section is rendered on the same tab — covered by Story 6.

**Edge cases & error states**
- Invalid webhook URL (not `http://` or `https://`) → 400 + inline error.
- Batch size out of range → 400 + inline error.
- Member without env access opens the URL `/admin/importers/<id>?env=<env_id>` directly: the env tab is hidden, and a direct PUT to the worker returns 404 (env-existence not leaked).
- Switching the env tab mid-edit discards unsaved changes (with a confirm prompt if the form is dirty).
- Saving with the same URL/options as before is a no-op (no row written, no `updated_at` bump).

**Acceptance criteria**
1. Member can create and update per-env config independently for each env they can access (URL, batch size, filter toggles).
2. The public `key` UUID is generated server-side on first config, is unique, and is shown read-only with a copy button.
3. Config for one env never affects another env.
4. Defaults apply when fields are omitted (batch size 1000, toggles off).
5. Invalid webhook URL (not http/https) or batch size out of range (< 1 or > 50000) is rejected client + server side.
6. A member without a grant for an env cannot see its tab; a direct API call to it returns 404.

**Test cases**
1. PUT first config for `(importer=tenants, env=staging)` → row exists with a non-empty `key`; GET returns the same row.
2. PUT a second config for `(importer=tenants, env=production)` → both rows coexist; one's URL is independent of the other's.
3. PUT with `webhook_url = "ftp://example.com"` → 400.
4. PUT with `batch_size = 0` → 400.
5. Member without `env_grant` for production PUTs production config → 404.
6. Copy-button presence on the key field (UI assertion).

---

### Story 6 — Webhook signing + secret/key rotation  *(open — issue #19)*

**User story**
As a member, I want to enable HMAC signing and rotate the secret (and the public key) for an environment, so that I can improve and maintain webhook security per environment.

**Detailed flow**
1. The Signing section on the env tab has a toggle: **Enable HMAC signing**.
2. Toggling on POSTs to `/api/importers/<id>/environments/<env_id>/signing`. The server generates a 32-byte URL-safe secret, stores it, sets `webhook_signing_enabled = 1`, and returns the secret **once** in the response body.
3. The SPA shows the secret in a reveal modal with a "store it now — you won't see this again" warning + copy-to-clipboard. Closing the modal hides it permanently.
4. **Rotate secret** is a button. Confirm dialog ("Rotating immediately invalidates the previous secret. Make sure the receiving service is updated."). On confirm, POST `.../rotate-secret`, server generates a new value, replaces the stored secret, returns the new value once via the same reveal modal.
5. **Rotate key** is a button. Confirm dialog ("Rotating the public key invalidates the previous one. Any external system that referenced it will need to be updated."). On confirm, POST `.../rotate-key`, server generates a new UUID, replaces the stored `key`, returns the new value (not secret — the key is intended to be visible).
6. Toggling signing off DELETEs `.../signing`. Server sets `webhook_signing_enabled = 0` and clears the stored secret.

**Edge cases & error states**
- GET responses for the env config never include the raw secret — only `webhook_signing_enabled` and a derived `secret_set: boolean` so the UI can render "stored" vs "not set" without exposing the value.
- Rotating when signing is off → 409 "Enable signing before rotating the secret."
- Rotating from a tab that the member no longer has a grant for (env access revoked mid-session) → 404.
- The secret-reveal modal is the only API surface that returns the secret. Refreshing the page after closing it loses access — by design.

**Acceptance criteria**
1. Toggling signing on generates and stores a secret and shows it exactly once in a reveal modal with the "store it now" warning.
2. Rotate secret replaces the stored secret and shows the new value once.
3. Rotate key replaces the public `key` UUID and keeps it unique; the old key no longer resolves.
4. GET responses never include the raw secret — only `webhook_signing_enabled` and a derived `secret_set` boolean.
5. Disabling signing clears the stored secret.

**Test cases**
1. POST signing → response body contains `secret`; D1 row has the same value in `webhook_secret`; `webhook_signing_enabled = 1`.
2. GET the env config → response has `secret_set: true` and no `secret` field. Assert key not in response at the JSON schema level.
3. POST rotate-secret → D1 `webhook_secret` changes; response returns the new value; old value never reappears in any GET.
4. POST rotate-key → D1 `key` changes; the old key UUID no longer resolves (resolver test).
5. DELETE signing → `webhook_signing_enabled = 0`, `webhook_secret IS NULL`, `secret_set: false` on next GET.
6. POST rotate-secret while signing is off → 409.

---

## 6. UI / UX Requirements

- **Loading states:** all writes show an inline spinner on the save button; the page-level shell never blanks during a save.
- **Empty states:**
  - Importers list with zero importers → "No importers yet. Click + New importer to create one."
  - Columns tab on a brand-new importer → "No columns yet. Click + Add column to define your CSV schema."
  - Unconfigured env tab → "Configure this environment to enable uploads."
- **Confirm dialogs** (modal, two-button: Cancel / Confirm) for: archive, unarchive, remove column, rotate secret, rotate key, disable signing.
- **Reveal modal** for secrets: blocks dismissal-by-clicking-outside; shows the secret in a monospaced field with a copy button; closing requires the user to click "I've stored it".
- **Error copy** (exact):
  - Duplicate importer name → "An importer with this name already exists."
  - Duplicate column name → "Another column already uses this name."
  - Invalid machine name → "Use lowercase letters, numbers, and underscores. Start with a letter."
  - Invalid webhook URL → "Webhook URL must start with http:// or https://."
  - Batch size out of range → "Batch size must be between 1 and 50,000."
  - Cross-env / cross-project 404 from the worker → render as "Not found." (don't leak)
- **Banner on the Columns tab:** persistent yellow, top of tab: "Column changes apply across all environments, including production. Existing uploads keep their original schema snapshot."
- **Drag handles** on column rows are visible by default (not hover-only) — the keyboard fallback's affordance comes from the dedicated up/down buttons.
- **Tabs** in the importer detail use the same env order as the top-nav environment switcher.

## 7. Data & Schema Changes

No new tables. The schema in [apps/worker/migrations/0001_initial.sql](../apps/worker/migrations/0001_initial.sql) and the uniqueness backstop in [apps/worker/migrations/0003_importer_name_unique.sql](../apps/worker/migrations/0003_importer_name_unique.sql) already cover:

- `importers (id, project_id, name, archived_at, created_at, updated_at)` with `UNIQUE(project_id, lower(name))`
- `importer_columns (id, importer_id, position, name, display_name, description, example, must_be_matched, value_cannot_be_blank, validation_type, validation_format, custom_error_message)` with `UNIQUE(importer_id, name)` and `UNIQUE(importer_id, position)`
- `importer_environments (id, importer_id, environment_id, key, webhook_url, webhook_signing_enabled, webhook_secret, batch_size, filter_invalid_rows, include_unmatched_columns)` with `UNIQUE(importer_id, environment_id)` and `UNIQUE(key)`

**New endpoints (all auth-gated via `requireSession` + project scope; env-tab endpoints additionally env-gated):**

| Verb | Path | Story | Notes |
|---|---|---|---|
| GET | `/api/importers` | 1 | Shipped. `?include_archived=true` includes archived. |
| POST | `/api/importers` | 1 | Shipped. `{ name }`; returns full importer row. |
| GET | `/api/importers/:id/columns` | (prereq) | Shipped. Used by the wizard. |
| **PATCH** | `/api/importers/:id` | 2 | `{ name?, archived?: boolean }` |
| **POST** | `/api/importers/:id/columns` | 3 | Column body; appends at `position = max + 1` |
| **PATCH** | `/api/importers/:id/columns/:column_id` | 3 | Partial update |
| **DELETE** | `/api/importers/:id/columns/:column_id` | 3 | |
| **PUT** | `/api/importers/:id/columns/order` | 4 | `{ ordered_ids: [...] }`, transactional |
| **PUT** | `/api/importers/:id/environments/:env_id` | 5 | Upsert delivery config |
| **POST** | `/api/importers/:id/environments/:env_id/signing` | 6 | Enable + generate secret (returns once) |
| **POST** | `/api/importers/:id/environments/:env_id/rotate-secret` | 6 | New secret (returns once) |
| **POST** | `/api/importers/:id/environments/:env_id/rotate-key` | 6 | New public UUID |
| **DELETE** | `/api/importers/:id/environments/:env_id/signing` | 6 | Disable + clear secret |

GET responses for the env config never include `webhook_secret`. The API surface includes a `secret_set: boolean` for the UI.

## 8. Technical Notes

- **Existing implementation:**
  - Worker routes live in [apps/worker/src/routes/importers.ts](../apps/worker/src/routes/importers.ts). It currently has `GET /`, `POST /`, and `GET /:importer_id/columns`. New endpoints chain onto the same `Hono` router.
  - Web routes already include [apps/web/src/routes/_authed/admin/importers.index.tsx](../apps/web/src/routes/_authed/admin/importers.index.tsx) (list + create) and [apps/web/src/routes/_authed/admin/importers.$id.tsx](../apps/web/src/routes/_authed/admin/importers.$id.tsx) (detail stub — currently renders "Columns editor coming soon"). This PRD turns that stub into the real tabbed editor.
  - The upload route is `importers.$id_.upload.tsx` (non-nested by the `_` convention), so adding tabs to the detail page does not affect the wizard. The upload route's "archived → 404" guard is added in Story 2.
  - Tests for the worker importer routes are in [apps/worker/test/importers.test.ts](../apps/worker/test/importers.test.ts) — extend, don't replace.
- **IDOR-resistance** is preserved by sourcing `project_id` only from `session.project_id` (never from request body) and returning 404 instead of 403 on cross-project hits — same pattern as PRD-002. For env-scoped writes, an `env_grants` join check (or owner role) gates access; failure also returns 404, not 403.
- **Column reorder transaction** ([Task 4](#story-4--column-reorder--open--issue-17)) must avoid `UNIQUE(importer_id, position)` collisions mid-transaction. The safe pattern: in a D1 batch, first write negative temp positions for every row in the set, then write the final 1..N. D1 batches are atomic for the same transaction.
- **Secret generation:** `crypto.getRandomValues(new Uint8Array(32))` then base64url. Stored as plaintext per PRD-001 §14 (at-rest encryption is out of scope for MVP; "read-never via API" is an API-surface guarantee, not an at-rest one).
- **`key` rotation:** straightforward `UPDATE importer_environments SET key = ? WHERE id = ?` inside the same project + env scope. The `UNIQUE(key)` index prevents collisions across the whole table.
- **The seeded Tenants importer must be editable through these endpoints.** No special-casing — its columns are just rows in `importer_columns`. The migration uses real UUIDs that round-trip through the API.
- **The upload-wizard archived-importer guard** is small but cross-cutting — Story 2's worker work includes adding `AND archived_at IS NULL` to the upload-wizard route's importer-resolution query.
- **Validation type → format coupling** is enforced server-side: e.g. `validation_type = 'date'` requires a non-empty `validation_format` from the 14 preset list. Client guides the user with a context-dependent format field; server rejects bad combinations with 400.

## 9. Platform-Specific Rules

Web only. Mobile out of scope (PRD-001 §11). Accessibility:

- All form fields have associated labels (the existing forms in the importer-list view pass the a11y audit; new modals must too).
- The drag-and-drop reorder has a keyboard-accessible fallback by AC.
- Confirm dialogs are focus-trapped and dismissable by Escape.
- The secret-reveal modal blocks Escape dismissal — closing requires the explicit "I've stored it" click (to avoid losing the value to muscle memory).

## 10. Linked Issues / PRDs

- **Parent:** [PRD-001 evo-csv](./prd-high-evo-csv.md)
- **Sibling shipped:** [PRD-002 Upload Wizard](./prd-feature-upload-wizard.md) — depends on this PRD's column data to render Match Columns and Review Grid steps.
- **Sibling forthcoming:** PRD-004 Webhook dispatch pipeline — consumes the `webhook_signing_enabled` / `webhook_secret` fields this PRD writes.
- **GitHub epic:** [Importer CRUD + Per-Environment Config (#13)](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/13)
- **GitHub child issues:**
  - Story 1 — Importer list + create — [#14](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/14) (closed, shipped in [PR #20](https://github.com/aphisak-w-mohara/usecsv-replacement/pull/20))
  - Story 2 — Importer general settings — [#15](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/15)
  - Story 3 — Column add / edit / remove — [#16](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/16)
  - Story 4 — Column reorder — [#17](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/17)
  - Story 5 — Per-environment delivery config — [#18](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/18)
  - Story 6 — Webhook signing + secret/key rotation — [#19](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/19)
- **Design spec:** [docs/superpowers/specs/2026-05-26-usecsv-clone-design.md](../docs/superpowers/specs/2026-05-26-usecsv-clone-design.md) — defines the tabbed editor layout and validation-type list this PRD references.
- **Empirical reference:** [usecsv-screenshots/](../usecsv-screenshots/) — the layout mirrors usecsv's admin where it makes sense.
