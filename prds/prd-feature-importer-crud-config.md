# Feature PRD — Importer CRUD + Per-Environment Config

**Trigger:** Use this when you are about to build a specific user flow or feature.
**Output:** A build-ready spec that can be handed directly to AI code generation or a developer.

**ID:** PRD-003
**Type:** Feature
**Parent PRD:** PRD-001 evo-csv
**Author:** Aphisak Naksomboon
**Date:** 2026-05-27
**Status:** Draft — Pending Review
**Target release:** Q3 2026 (TBC)
**Version:** 1.0

## Version history
| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | 2026-05-27 | Aphisak Naksomboon | Initial draft |

## 1. Context

Before a dev can run the upload wizard (PRD-002), an **importer** has to exist: a named CSV schema (e.g. "Tenants", "Properties") with a column list, plus a per-environment delivery config (webhook URL, batch size, signing, secret). Today the schema tables exist in D1 and there is a single read-only endpoint (`GET /api/importers/:id/columns`), but there is **no way to create, list, edit, or archive importers, edit their columns, or set per-environment delivery config from the app** — everything is hand-seeded via SQL migrations. This PRD covers that configuration surface: the **Importers list + importer detail tabbed editor** and the API endpoints behind them.

This is the "set it up once" counterpart to the upload wizard's "use it every day." It maps to journey **7.2 Configure an importer** in the parent PRD.

**Parent PRD:** [PRD-001 evo-csv](./prd-high-evo-csv.md)
**Feature area:** Importer configuration / admin

## 2. Scope

### What is being built

A logged-in member with env access can:
- See the list of importers in the current project (with archived ones hidden by default), and create a new importer.
- Open an importer detail page laid out as tabs: **General · Columns · {one tab per environment}**.
- **General:** rename the importer, archive/unarchive it.
- **Columns:** add/edit/reorder/remove columns — machine `name`, display name, description, example, required (`must_be_matched`), non-blank (`value_cannot_be_blank`), validation type/format, custom error message. Columns are **project-level / shared across all environments**.
- **Per-environment tabs:** set webhook URL, toggle HMAC signing, set/rotate the webhook secret, set batch size, toggle `filter_invalid_rows` and `include_unmatched_columns`, view the public `key` UUID, and rotate it. Each env config is created lazily (an env tab with no config yet shows a "configure this environment" empty state).

All writes are project- and env-scoped from session context (never from the request body), consistent with the existing IDOR-resistant repo pattern.

### What is not being built (out of scope)

- The upload wizard itself (PRD-002) — this PRD only makes importers *runnable*.
- Webhook dispatch / HMAC *signing logic* (sibling "Webhook dispatch pipeline" PRD) — this PRD only stores the toggle + secret.
- Owner-only environment CRUD (create/delete environments) and member/invite/grant management — that's the "Auth & bootstrap" / Settings surface, a separate PRD.
- Bulk column import (e.g. paste a header row to auto-generate columns) — deferred; columns are added manually.
- Importer-level versioning / schema change history.
- Hard delete of importers (we archive, never delete, to preserve upload audit trail).

**Sign-off:** [ ] Approved by Aphisak Naksomboon on [date]

## 3. Current State vs Desired End State

|  | Description |
|---|---|
| **Current state** | Importers, columns, and per-env config exist only as rows seeded by SQL migrations (`0001_initial.sql`, `0002_seed_tenants_columns.sql`). The only runtime surface is `GET /api/importers/:id/columns` (read-only). To add or change an importer today, a dev edits a migration and re-applies it. |
| **Desired end state** | A member opens the **Importers** sidebar item, creates/edits importers and their columns through a tabbed editor, and wires each environment's delivery config — all from the app, no SQL. The seeded Tenants importer is editable through the same UI. |

## 4. Permissions Impact

Per the parent PRD permissions matrix, importer + column + env-config management requires **env access** (any granted env). Owners have implicit access to all envs.

| Role | Can do | Cannot do |
|---|---|---|
| **Owner** | Full CRUD on importers, columns, and all per-env configs across every environment | — |
| **Member with env access** | Create/edit/archive importers, edit columns (project-level, affects all envs), edit per-env config for envs they're granted | Edit per-env config for an env they have no grant for (env tab is hidden / route 404) |
| **Member without env access** | Nothing in this flow | Reach the Importers list at all for that project context |

**Business rule (from PRD-001):** column schemas are project-level, so a member with access to *any* env can edit columns that affect *every* env. This is the intentional "trust the team" tradeoff.

## 5. User Stories & Acceptance Criteria

---

### Story 1 — Member views the importer list and creates a new importer

**User story**
As a member with env access, I want to see all importers in the project and create a new one, so that I can set up a new CSV schema for a client onboarding.

**Detailed flow**
1. Member clicks **Importers** in the sidebar (default landing page).
2. SPA calls `GET /api/importers` and renders a list (name, # columns, # configured envs, last updated). Archived importers hidden behind a "Show archived" toggle.
3. Member clicks **+ New importer**, enters a name, confirms.
4. SPA calls `POST /api/importers`, receives the new importer, and routes to its detail page on the **Columns** tab (empty state).

**Edge cases & error states**
- Duplicate importer name within the project → 409, inline "An importer with this name already exists."
- Empty/whitespace-only name → client-side validation blocks submit.
- No importers yet → empty state with a "Create your first importer" CTA.

**Acceptance criteria**
1. Member sees all non-archived importers in the current project, never importers from another project.
2. Member can create an importer with a unique name and is taken straight to its editor.
3. Archived importers are hidden by default and shown via the toggle.

**Test cases**
1. Creating an importer with a name that exists (case-insensitive) returns 409.
2. A forged `project_id` in the request body is ignored; the importer is created under the session's project.

---

### Story 2 — Member edits importer general settings (rename, archive)

**User story**
As a member, I want to rename or archive an importer, so that I can keep the importer list tidy and correct.

**Detailed flow**
1. On importer detail → **General** tab, member edits the name and saves.
2. SPA calls `PATCH /api/importers/:id`.
3. Member clicks **Archive**; a confirm dialog warns that archived importers are hidden and can no longer be used for uploads. On confirm, `PATCH /api/importers/:id` sets `archived_at`.
4. Archived importer shows an **Unarchive** action.

**Edge cases & error states**
- Renaming to a name that collides with another importer → 409.
- Archiving an importer that has in-flight uploads → allowed, but the General tab surfaces a note that historical uploads remain viewable.

**Acceptance criteria**
1. Renaming updates the name and `updated_at`.
2. Archiving sets `archived_at`, removes it from the default list, and prevents it appearing as an upload target.
3. Unarchiving clears `archived_at`.

**Test cases**
1. Archived importer does not appear in `GET /api/importers` without `?include_archived=true`.
2. Archived importer cannot be selected as an upload target.

---

### Story 3 — Member edits the column schema

**User story**
As a member, I want to add, edit, reorder, and remove columns on an importer, so that the upload wizard matches and validates the right fields.

**Detailed flow**
1. On the **Columns** tab, member sees the ordered column list.
2. Member adds a column: machine `name` (snake_case, the webhook JSON key), display name, description, example, required toggle (`must_be_matched`), non-blank toggle (`value_cannot_be_blank`), validation type (the 8 usecsv types), optional validation format, optional custom error message.
3. Member reorders columns by drag or up/down; `position` is recalculated.
4. Member edits or removes a column.
5. SPA persists via the column write endpoints (see §7). A save affects the importer across **all** environments.

**Edge cases & error states**
- Duplicate `name` within the importer → 409 (DB enforces `UNIQUE(importer_id, name)`), inline error.
- `name` not matching `^[a-z][a-z0-9_]*$` → client-side validation blocks.
- Removing a column that a past upload's `matched_columns_map` referenced → allowed; historical uploads keep their snapshot and are unaffected.
- A warning banner reminds the member that column edits are project-level and affect production too.

**Acceptance criteria**
1. Member can add a column with all fields; it appears at the end of the order.
2. Member can edit any field of an existing column.
3. Member can reorder columns and the new order persists.
4. Member can remove a column.
5. Duplicate machine names are rejected.

**Test cases**
1. Adding two columns with the same `name` returns 409.
2. Reordering then reloading the page preserves the new `position` order.
3. The seeded Tenants importer's columns load and are editable.

---

### Story 4 — Member configures an environment's delivery settings

**User story**
As a member with access to an environment, I want to set that environment's webhook URL and delivery options, so that uploads run against the right backend.

**Detailed flow**
1. Member opens the env tab (e.g. **Staging**). If no config exists, an empty state offers "Configure Staging."
2. Member sets webhook URL, batch size (default 1000), `filter_invalid_rows`, `include_unmatched_columns`.
3. Member saves via `PUT /api/importers/:id/environments/:env_id` (upsert).
4. The env tab shows the public `key` UUID (read-only) with a copy button.

**Edge cases & error states**
- Invalid webhook URL (not http/https) → client + server validation, inline error.
- Batch size out of range (< 1 or > 50000) → validation error.
- Member without a grant for that env → the tab is not rendered; a direct API call returns 404.

**Acceptance criteria**
1. Member can create and update per-env config independently for each env they can access.
2. `key` is generated server-side on first config and is unique.
3. Config for one env never affects another env.
4. Defaults apply when fields are omitted (batch size 1000, toggles off).

**Test cases**
1. Configuring Staging leaves Production config untouched.
2. A member without a Production grant gets 404 on `PUT .../environments/:prod_env_id`.
3. Forged `importer_id` / `environment_id` outside the session's project return 404.

---

### Story 5 — Member manages webhook signing and rotates secrets/keys

**User story**
As a member, I want to enable HMAC signing and rotate the secret (and the public key) for an environment, so that I can improve and maintain webhook security per environment.

**Detailed flow**
1. On the env tab, member toggles **Webhook signing** on.
2. On enabling, the SPA requests a generated secret; the secret is shown once with a copy button and a "store it now" warning.
3. Member can click **Rotate secret** later → new secret generated, shown once, old one invalidated.
4. Member can click **Rotate key** → new public `key` UUID issued (invalidates the old key for any external reference).
5. Member can disable signing (toggle off); the stored secret is cleared.

**Edge cases & error states**
- Enabling signing without the dispatch pipeline deployed → still allowed (storage-only here); a note clarifies signing takes effect once the dispatch pipeline honours it.
- Rotating a secret is irreversible — confirm dialog.
- Secret value is **never** returned again after creation (write-once read-never); subsequent GETs return only `webhook_signing_enabled` + a "secret set" boolean.

**Acceptance criteria**
1. Toggling signing on generates and stores a secret and shows it exactly once.
2. Rotate secret replaces the stored secret and shows the new value once.
3. Rotate key replaces the `key` UUID and keeps it unique.
4. GET responses never include the raw secret.
5. Disabling signing clears the secret.

**Test cases**
1. After enabling signing, a GET on the env config returns `secret_set: true` but no secret value.
2. Rotating the key changes the `key` and the old key no longer resolves.

---

## 6. UI / UX Requirements

- **Importer list:** table with name, column count, configured-env count, updated-at; "+ New importer"; "Show archived" toggle. Empty state with CTA.
- **Importer detail:** tabbed editor — `General · Columns · {Env tabs}`. Only env tabs the member can access are shown (owners see all).
- **Screen states:** loading (skeleton rows), empty (no importers / no columns / unconfigured env), error (inline + retry), success (toast on save).
- **Column editor:** inline-editable rows with drag-to-reorder; validation-type dropdown listing the 8 usecsv types; per-row required / non-blank toggles.
- **Secret reveal:** modal showing the secret once, copy button, explicit "you won't see this again" warning.
- **Destructive confirmations:** archive importer, rotate secret, rotate key, remove column → confirm dialogs.
- **Cross-env warning:** persistent note on the Columns tab that edits affect all environments including production.
- **Error copy (examples):**
  - "An importer with this name already exists."
  - "Column names must be lowercase letters, numbers, and underscores, starting with a letter."
  - "Enter a valid http(s) webhook URL."
  - "Store this secret now — it won't be shown again."

## 7. Data & Schema Changes

The schema already exists (`0001_initial.sql`). No table changes anticipated; this feature is mostly new **endpoints** over existing tables. Confirm during build whether any column (e.g. an importer `description`) is desired — none required for MVP.

- **New fields:** none expected (revisit if a UI field has no column to land in).
- **Modified fields:** none.
- **New endpoints:**
  - `GET /api/importers` — list importers in session project (`?include_archived=true` optional).
  - `POST /api/importers` — create importer `{ name }`.
  - `GET /api/importers/:id` — importer detail incl. columns + per-env config summaries (signing flag + `secret_set`, never raw secret).
  - `PATCH /api/importers/:id` — rename / archive / unarchive `{ name?, archived?: boolean }`.
  - `POST /api/importers/:id/columns` — add column.
  - `PATCH /api/importers/:id/columns/:column_id` — edit column.
  - `DELETE /api/importers/:id/columns/:column_id` — remove column.
  - `PUT /api/importers/:id/columns/order` — bulk reorder `{ ordered_ids: [...] }`.
  - `PUT /api/importers/:id/environments/:env_id` — upsert per-env delivery config (URL, batch size, toggles).
  - `POST /api/importers/:id/environments/:env_id/signing` — enable signing + generate secret (returns secret once).
  - `POST /api/importers/:id/environments/:env_id/rotate-secret` — rotate secret (returns secret once).
  - `POST /api/importers/:id/environments/:env_id/rotate-key` — rotate public key.
  - `DELETE /api/importers/:id/environments/:env_id/signing` — disable signing, clear secret.
- **Modified endpoints:** existing `GET /api/importers/:id/columns` stays; may be folded into `GET /api/importers/:id`.

## 8. Technical Notes

- **Existing code:** [`apps/worker/src/routes/importers.ts`](../apps/worker/src/routes/importers.ts) currently exposes only `GET /:importer_id/columns`, with a project-scoped existence check returning **404 (not 403)** for cross-project access to avoid leaking existence. New endpoints must follow this same pattern. The router is mounted in [`apps/worker/src/index.ts`](../apps/worker/src/index.ts).
- **Schema:** all relevant tables in [`apps/worker/migrations/0001_initial.sql`](../apps/worker/migrations/0001_initial.sql) — note `UNIQUE(importer_id, name)` and `UNIQUE(importer_id, position)` on `importer_columns`, and `UNIQUE(importer_id, environment_id)` + `UNIQUE(key)` on `importer_environments`. Reorder must avoid transient unique-collisions on `position` (e.g. write negative temp positions or use a transaction).
- **Tenants column seed:** [`apps/worker/migrations/0002_seed_tenants_columns.sql`](../apps/worker/migrations/0002_seed_tenants_columns.sql) — the seeded importer must be fully editable through these endpoints.
- **IDOR resistance:** `project_id` and granted env IDs come only from session/middleware context, never request body — consistent with the parent PRD's NFRs.
- **Secret handling:** `webhook_secret` is write-once / read-never via the API. GET responses expose only `webhook_signing_enabled` and a derived `secret_set` boolean. (Stored as plaintext in D1 per current schema; at-rest encryption is out of scope for MVP.)
- **Validation types:** mirror usecsv's 8 validation types (see design spec); column `validation_type` defaults to `'string'`.
- **Env access middleware:** reuse the same `withEnvironment`-style guard referenced in PRD-002 for per-env config writes.
- **Tests:** existing `apps/worker/test/importers.test.ts` should be extended for the new CRUD endpoints.

## 9. Platform-Specific Rules

Web only (desktop-first internal tool). No mobile. Accessibility: tab editor and column rows must be keyboard-navigable; drag-reorder needs a keyboard fallback (up/down buttons).

## 10. Linked Issues / PRDs

- **Parent:** [PRD-001 evo-csv](./prd-high-evo-csv.md) — journey 7.2.
- **Sibling (upstream consumer):** [PRD-002 Upload Wizard](./prd-feature-upload-wizard.md) — depends on importers + columns + per-env config existing.
- **Sibling (downstream):** Webhook dispatch pipeline PRD (forthcoming) — honours the `webhook_signing_enabled` / `webhook_secret` this feature stores.
- **Design spec:** [`docs/superpowers/specs/2026-05-26-usecsv-clone-design.md`](../docs/superpowers/specs/2026-05-26-usecsv-clone-design.md).
