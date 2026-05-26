# Self-hosted UseCSV clone (evo-csv) — design spec

**Date:** 2026-05-26
**Status:** Draft, pending user review
**Authors:** Aphisak Naksomboon (with Claude)

## Context

EVO (the Mohara property-management platform) currently uses [usecsv.com](https://usecsv.com) as a hosted CSV importer for **Properties** and **Tenants** data. Staff configure importers in usecsv's admin dashboard; the Mohara dev team uploads CSVs (received from EVO clients) through usecsv's hosted UI; usecsv POSTs the parsed rows to two webhook endpoints on the EVO Laravel backend (`/webhook/property/import`, `/webhook/tenants/import`).

**This is an internal tool.** Every uploader is a logged-in Mohara dev team member acting on behalf of a client whose CSV they have in hand. There is no anonymous public-URL flow — clients do not upload directly through evo-csv.

The Laravel side is real and battle-tested. Files referenced throughout this spec:

- [routes/web.php](evo-laravel-server/routes/web.php) — webhook endpoints
- [app/Http/Controllers/WebhookController.php](evo-laravel-server/app/Http/Controllers/WebhookController.php) — handlers
- [app/Http/Requests/UseCSV/ImporterRequest.php](evo-laravel-server/app/Http/Requests/UseCSV/ImporterRequest.php) — payload validation
- [app/Imports/PropertiesImport.php](evo-laravel-server/app/Imports/PropertiesImport.php), [app/Imports/TenantsImport.php](evo-laravel-server/app/Imports/TenantsImport.php) — domain processors
- [tests/Mocks/Imports/Tenants/import-success.json](evo-laravel-server/tests/Mocks/Imports/Tenants/import-success.json), [tests/Mocks/Properties/import-success.json](evo-laravel-server/tests/Mocks/Properties/import-success.json) — canonical payload fixtures

**Goal:** replace usecsv.com with a self-hosted clone (`evo-csv`) that produces a **byte-identical webhook payload** so the Laravel side requires no code change for MVP, plus add the operational features EVO actually needs (multi-environment, Google SSO, per-importer signed webhooks).

**Non-goals for MVP:** see the explicit out-of-scope list at the end.

## Scope at a glance

| In scope | Out of scope |
|---|---|
| Internal admin tool at `app.<domain>` (all routes auth-gated) | Anonymous / public upload URLs |
| Configure importers + run uploads from one frontend | JS/React SDK packages (`@evo/csv-js`, `@evo/csv-react`) |
| Webhook delivery byte-compatible with usecsv | `onData` browser-callback delivery mode |
| Multi-tenant (projects) for future Mohara products | Themes, multi-language (English only) |
| Multi-environment per project (prod/staging/uat) | Validation hooks (`onRecordsInitial`, `onRecordEdit`) |
| Google SSO authentication | Email/password auth, magic links |
| Optional per-importer HMAC webhook signing | Mandatory signing (existing Laravel keeps working) |
| Property + Tenants column schemas seeded from Laravel | Other entity types (Job Requests, etc.) |
| Per-upload context (`user`/`metadata` form) for audit trail | Client-facing self-service portal |

## Decisions log

| # | Decision | Status |
|---|---|---|
| 1 | Stack: React + Vite 8 + Hono on Cloudflare Workers, pnpm workspace, Hono RPC | locked |
| 2 | MVP = single internal frontend (admin + upload behind same auth); no SDK packages | locked |
| 3 | Multi-tenant (projects) — kept lightweight for future Mohara products | locked |
| 4 | Authentication: Google SSO only; every uploader is logged in | locked |
| 5 | Webhook signing: optional per-importer-environment, off by default | locked |
| 6 | Multi-environment per project, with two-layer permissions | locked |
| 7 | Webhook payload byte-identical to usecsv's (incl. 1-based `batch.index`) | locked |
| 8 | No anonymous public-URL flow; the only unauthenticated routes are `/login` and `/invites/:token` | locked |
| 9 | Closed SSO signup: callback rejects unknown emails (no auto-account-creation). First owner seeded by one-shot CLI bootstrap | locked |

## Architecture

One Cloudflare project, one deployed Worker, one hostname.

```
   Mohara dev team member                  ┌──────────────────────────────────┐
   ┌─────────────────────────┐             │  Cloudflare Worker (Hono)        │
   │  app.<domain>/admin/... │  React SPA  │                                  │
   │  (Google SSO required)  │ ──────────▶ │  • / *           static (Vite)   │
   │  • configure importers  │  REST + JSON│  • /api/*        Hono routes     │
   │  • run CSV uploads      │             │  • All routes auth-gated         │
   │  • view import history  │             │  • Bindings: D1, R2, KV, QUEUE   │
   └─────────────────────────┘             └────────┬─────────────────────────┘
                                                    │
                                                    │  produces signed/unsigned
                                                    │  webhook POST per batch
                                                    ▼
                                          ┌──────────────────────────────────┐
                                          │  CF Queue → worker consumer →    │
                                          │  POST batch → customer webhook   │
                                          │  e.g. laravel-prod.evo-pm.com/   │
                                          │       webhook/tenants/import     │
                                          │  200=next batch                  │
                                          │  non-2xx=halt + retry exp backoff│
                                          └──────────────────────────────────┘
```

**Why one Worker, not three:** for MVP, splitting admin/api into separate workers buys nothing — same auth, same bindings, same DB.

**Why no Durable Objects:** uploads are POSTed in chunks straight to the API; upload state lives in D1 + R2 the whole way. The batch dispatcher runs as a Queue consumer, not a stateful DO. We re-add DOs only if real-time per-row progress becomes important.

**No public/anonymous surface:** every Hono route requires a session. There is no `/i/<key>` public flow. Importer keys still exist on each (importer × environment) row but they're internal identifiers + the value placed in the `importerId` webhook field for backward compatibility — they are not URL caps.

**End-to-end flow of one import:**

1. Dev team member logs into `app.<domain>/admin` via Google SSO → picks active Project + Environment.
2. (One-time per importer) An admin creates importer "Tenants" with column schema + per-env webhook URL → API stores in D1 → returns `key=<uuid>` for the (importer × env) pair.
3. To run an upload: dev team member opens `/admin/importers/:id/upload`. Step 0 is an optional **upload context form** (`user` and `metadata` JSON, ticket reference, free-text note). Step 1–4 is the wizard: Upload File → Match Columns → Review & Edit → Submit.
4. SPA parses CSV/XLSX client-side (PapaParse + SheetJS), fuzzy-suggests column map, surfaces validation errors in a virtualized grid for inline editing, then submits.
5. SPA `POST /api/uploads` to create upload → `POST /api/uploads/:id/batches/:idx` for each chunk of 1000 rows. API stores rows in R2 (`uploads/<id>/batches/<idx>.json`) and queues a webhook dispatch job per batch.
6. Queue consumer drains jobs **in batch.index order**: POSTs the canonical payload to the importer-environment's webhook URL, signs if enabled, captures the 200-with-errors response, writes a `webhook_attempts` row. Admin UI polls `/api/uploads/:id` for status.

## Data model

### Conceptual hierarchy

```
Project (= tenant, e.g., "EVO")
  ├─ Members (Users with project-level role)
  ├─ Environment (e.g., "production")
  │    ├─ Environment grants (per-user, env-scoped role override)
  │    └─ Importer-Environment configs (delivery + secret + per-env settings)
  ├─ Environment ("staging")
  ├─ Environment ("uat")
  └─ Importer ("Tenants")            ← logical, schema only
       └─ Columns (shared across envs)
```

### D1 schema

```sql
projects
  id TEXT pk                              -- ulid
  slug TEXT unique
  name TEXT
  allowed_email_domain TEXT NULL          -- Google hosted-domain restriction
  created_at INTEGER

users
  id TEXT pk
  email TEXT unique
  google_sub TEXT unique                  -- Google's stable subject id
  name TEXT
  picture_url TEXT NULL
  last_active_project_id TEXT NULL
  last_active_environment_id TEXT NULL
  created_at INTEGER

memberships                               -- baseline project access
  project_id TEXT fk
  user_id TEXT fk
  role TEXT                               -- 'owner' | 'admin' | 'member' | 'viewer'
  PRIMARY KEY (project_id, user_id)

invites
  id TEXT pk
  project_id TEXT fk
  email TEXT
  role TEXT
  token TEXT unique
  invited_by TEXT fk users.id
  expires_at INTEGER
  accepted_at INTEGER NULL
  UNIQUE(project_id, email)

environments
  id TEXT pk
  project_id TEXT fk
  slug TEXT                               -- 'production' | 'staging' | 'uat' | custom
  name TEXT
  is_default INTEGER                      -- exactly one true per project
  created_at INTEGER
  UNIQUE(project_id, slug)

environment_grants                        -- additive, env-scoped role override
  project_id TEXT fk
  user_id TEXT fk
  environment_id TEXT fk
  role TEXT                               -- 'admin' | 'member' | 'viewer'
  PRIMARY KEY (project_id, user_id, environment_id)

importers
  id TEXT pk
  project_id TEXT fk
  name TEXT
  archived_at INTEGER NULL
  created_at INTEGER, updated_at INTEGER

importer_columns
  id TEXT pk
  importer_id TEXT fk
  position INTEGER
  name TEXT                               -- machine name, sent in webhook rows
  display_name TEXT
  description TEXT NULL
  example TEXT NULL
  must_be_matched INTEGER
  value_cannot_be_blank INTEGER
  validation_type TEXT                    -- 'string'|'number'|'date'|'phone'|'email'|'regex'|'select'|'boolean'
  validation_format TEXT NULL             -- json blob (date format, regex pattern, select opts, etc.)
  custom_error_message TEXT NULL

importer_environments                     -- per-(importer × env) delivery config
  id TEXT pk
  importer_id TEXT fk
  environment_id TEXT fk
  key TEXT unique                         -- public UUID handed to embedders / URLs
  webhook_url TEXT
  webhook_signing_enabled INTEGER DEFAULT 0
  webhook_secret TEXT NULL                -- only if signing enabled; rotatable
  batch_size INTEGER DEFAULT 1000
  filter_invalid_rows INTEGER DEFAULT 0
  include_unmatched_columns INTEGER DEFAULT 0
  UNIQUE(importer_id, environment_id)

uploads
  id TEXT pk                              -- public id (ulid)
  numeric_id INTEGER unique               -- 1-based auto-increment; goes in webhook `uploadId`
  project_id TEXT fk
  importer_environment_id TEXT fk
  file_name TEXT
  file_size INTEGER
  r2_source_key TEXT
  matched_columns_map TEXT                -- json
  uploaded_file_headers TEXT              -- json
  user_payload TEXT NULL                  -- json from ?user=
  metadata_payload TEXT NULL              -- json from ?metadata=
  total_rows INTEGER
  batch_size INTEGER
  batch_count INTEGER
  status TEXT                             -- 'pending'|'dispatching'|'completed'|'halted'|'failed'
  created_at INTEGER, updated_at INTEGER

webhook_attempts
  id TEXT pk
  upload_id TEXT fk
  batch_index INTEGER                     -- 1-based (matches webhook payload)
  attempt_number INTEGER
  status_code INTEGER NULL
  response_body TEXT NULL                 -- truncated to ~16KB
  errors_json TEXT NULL                   -- parsed {errors:[{row,msg}]} from Laravel
  started_at INTEGER, finished_at INTEGER NULL
  UNIQUE(upload_id, batch_index, attempt_number)
```

### Effective permission resolver

```
effective_role(user, project, environment) =
  strongest_of(
    memberships[project, user]?.role,
    environment_grants[project, user, environment]?.role,
    'none'
  )
```

Capability matrix:

| Capability | viewer | member | admin | owner |
|---|:-:|:-:|:-:|:-:|
| See importer list + history in env | ✅ | ✅ | ✅ | ✅ |
| **Run a CSV upload in env** | — | ✅ | ✅ | ✅ |
| Retry a failed batch | — | ✅ | ✅ | ✅ |
| Edit importer settings / columns | — | — | ✅ | ✅ |
| Rotate webhook secret | — | — | ✅ | ✅ |
| Create/delete environments | — | — | — | ✅ |
| Invite members, assign project roles | — | — | — | ✅ |

Every action requires an authenticated session. There is no anonymous surface — possession of an importer key is **not** a capability; the dev team member must have an authenticated session with the `member` role (or higher) in the target environment to upload.

### R2 layout

```
uploads/<upload_id>/source.<ext>             # original file as uploaded
uploads/<upload_id>/batches/<batch_index>.json
                                             # exact body POSTed to webhook
```

R2 lifecycle rule: source + batch payloads auto-delete after 30 days. Per-tenant retention overrides come post-MVP.

### KV layout

```
session:<token>                       → { user_id, project_id, environment_id, role, expires_at }
                                        TTL = session lifetime (14 days rolling)
importer_env:<key>                    → { id, project_id, environment_id, importer_id,
                                          webhook_url, signing_enabled, batch_size }
                                        TTL 5 min; invalidated on importer-env update
ratelimit:<key>:<minute_bucket>       → counter (post-MVP)
```

### Queue message shape

```ts
type WebhookDispatchJob = {
  uploadId: string;         // ulid (uploads.id)
  batchIndex: number;       // 1-based, matches webhook payload
  attempt: number;          // for retries
};
```

Consumer reads the batch payload from R2 (so messages stay tiny), POSTs to `importer_environments.webhook_url`, signs if enabled, writes `webhook_attempts` row, and on non-2xx re-enqueues with exponential backoff (10s, 30s, 2m, 10m, 1h, 6h). After 6 failures → `upload.status = 'halted'` and stop dispatching subsequent batches (matches usecsv's sequential 2xx-gating).

## Webhook contract

### Outbound POST

```http
POST <configured webhook URL>
Content-Type: application/json
User-Agent: evo-csv/<version> (+https://app.<domain>)
X-Evo-Signature: sha256=<hex>      ← only when signing is enabled
X-Evo-Timestamp: 1748275200        ← only when signing is enabled
```

```json
{
  "uploadId": 1842,
  "fileName": "tenants_may2026.csv",
  "importerId": "ad7c...-...-...",
  "matchedColumnsMap": { "Customer Email": "email", "First name": "first_name" },
  "uploadedFileHeaders": ["First name", "Last name", "Customer Email"],
  "batch":    { "index": 1, "count": 5, "totalRows": 4321 },
  "user":     { "userId": "12345" },
  "metadata": { "anotherId": "1" },
  "rows": [
    { "row": 1, "first_name": "Alice", "last_name": "Smith", "email": "a@b.com" }
  ]
}
```

**Invariants we will not violate** (sourced from Laravel code + usecsv docs):

- `uploadId` is an **integer**, not a string. Source: `uploads.numeric_id`.
- `importerId` is a **UUID string** (specifically `importer_environments.key`, since the importer + environment together identify the source of an upload — naming kept for compatibility).
- `batch.index` is **1-based**. Final batch is `batch.index === batch.count`. Laravel's [TenantsImport.php:177-188](evo-laravel-server/app/Imports/TenantsImport.php) relies on this equality to dispatch follow-up jobs (`NewResidentEmail`, `ValidateTenantNumber`, `TenantReport`). Off-by-one breaks tenant onboarding.
- `rows[i].row` is the **1-based source row number**, echoed back by Laravel in error responses.
- `user` and `metadata` are either the parsed JSON objects from URL query params, or `null` — never `undefined`, never omitted.
- The outbound payload does **not** include an environment field. Each environment has its own webhook URL.

### Inbound — Laravel's response

Laravel always returns `200 OK` with body `{ "errors": [{ "row": <int>, "msg": "<string>" }, ...] }`. The consumer handles each case:

| HTTP | Body | Outcome |
|------|------|---------|
| 2xx  | `errors: []` | Batch ok. Proceed to next batch. |
| 2xx  | `errors: [...]` | Row-level failures recorded in `webhook_attempts.errors_json`, surfaced in UI. **Proceed** to next batch. |
| 4xx/5xx | any | Retry with exp. backoff (10s, 30s, 2m, 10m, 1h, 6h). After 6 failures: `upload.status = 'halted'`. |
| timeout (>10 min) | n/a | Same as 5xx — retry. |

### Signing (when enabled)

```
signature_payload = "<X-Evo-Timestamp>.<raw body>"
X-Evo-Signature   = "sha256=" + hex(hmac_sha256(importer_env.webhook_secret, signature_payload))
```

Off by default. When the admin enables it for the first time, the UI shows the secret once and a copy-paste Laravel middleware snippet (~15 lines: constant-time compare + 5-min timestamp skew window) to add to `evo-laravel-server/app/Http/Middleware/VerifyEvoCsvSignature.php`.

### Retry / idempotency

- `(uploadId, batch.index)` is a stable pair — Laravel can dedupe on it. Existing Laravel doesn't dedupe explicitly but row creation is idempotent: `tenants.email` is unique, `importer_relationships.parent_reference` is unique-within-import.
- Migration `2025_12_02_130328_remove_unique_constraint_from_imports_batch_id` already removed the uniqueness constraint that would have blocked retries.

### EVO migration path

For each importer EVO currently has on usecsv.com:

1. In our admin, create the corresponding importer + columns (use `tools/seed-evo-importers.ts` for "Tenants" and "Properties").
2. For each environment (production / staging / uat), set the same webhook URL EVO already configured in usecsv.
3. Invite the dev team via Google SSO; assign `environment_grants` so each member has the right access per env (e.g., junior devs limited to staging+uat). Decommission the usecsv.com side.

**No Laravel code change required for MVP.** When/if EVO enables signing per importer-environment, ship a one-PR addition to `evo-laravel-server` adding the verification middleware.

## Authentication — Google SSO

### Why Google SSO only

- All EVO staff are on Google Workspace (mohara.co)
- No password hashing / Argon2id WASM bundle to maintain
- No "forgot password" flow, no rotation policy, no leaked-password risk
- Hono has a first-class provider

If external (non-Google) users ever need access, we add magic-link via Cloudflare Email Routing → MailChannels. Not in MVP.

### Stack

- `@hono/oauth-providers/google` for the OAuth dance
- Opaque sessions in KV (decoupled from Google availability)
- Secrets via `wrangler secret put`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `SESSION_COOKIE_SECRET`

### Sign-in flow

SSO sign-in is **closed by default** — only pre-existing members or holders of a pending invite can complete the dance. There is no "anyone with a Google account can sign up" surface.

```
1. User visits /admin → no session → redirect to /login
2. /login renders "Continue with Google"
3. → /api/auth/google/login → OAuth state, redirect to Google
   (scope: openid email profile; optional &hd=<allowed_email_domain>)
4. Google → /api/auth/google/callback?code=...
5. Exchange code → fetch profile (sub, email, name, picture)
6. Match logic:
   ├─ google_sub match       → create session
   ├─ email match (no sub)   → bind sub → create session
   │                            (handles bootstrapped users + pending invites)
   ├─ pending invite by email → create user, bind sub, materialize membership → session
   └─ otherwise              → 403 "Not authorized. Ask a project owner for an invite."
                                Do NOT create a users row.
7. Redirect to original /admin URL
```

### Bootstrap: how the first owner is created

The first user (and any disaster-recovery additions of new owners) is seeded by a one-shot CLI command, not by signing in. This keeps the SSO callback closed.

```bash
pnpm bootstrap \
  --email aphisak@mohara.co \
  --name "Aphisak Naksomboon" \
  --project-name "EVO" \
  --project-slug "evo" \
  --allowed-domain "mohara.co"
```

Implemented in `tools/bootstrap.ts` as a thin wrapper around `wrangler d1 execute`. In one transaction it:

1. Inserts a `projects` row with `slug`, `name`, `allowed_email_domain`.
2. Inserts a `users` row with `email`, `name`, and `google_sub = NULL` (filled in on first SSO match).
3. Inserts a `memberships` row with `role = 'owner'`.
4. Inserts a default `environments` row (`slug='production'`, `is_default=1`).

The human then signs in via Google SSO; the callback finds the pre-seeded user by email, binds `google_sub`, and they land in the project as owner.

**Why CLI not env var or first-user-wins:**

- **First-user-wins** has a race condition (anyone who finds the URL first becomes owner).
- **`BOOTSTRAP_OWNER_EMAIL` Wrangler secret** is a landmine — anyone matching that email forever auto-promotes to owner if the secret isn't rotated.
- **CLI seed** is one-shot, auditable, leaves no runtime auto-grant surface. Disaster recovery (adding a second owner if access is lost) is just `pnpm bootstrap --email <new>@mohara.co --project-slug evo`.

### Per-project domain restriction

`projects.allowed_email_domain` (e.g., `mohara.co`):

- Sign-in URL appends `&hd=mohara.co`
- Callback verifies returned email's domain; rejects mismatches
- Invites cannot be created for non-matching domains while restriction is active

## UI surfaces

### Admin app (`app.<domain>/admin/...`)

Every route requires a session. The only unauthenticated route in the whole app is `/login`.

```
/login                                       Google SSO button
/invites/:token                              accept invite → triggers SSO
/admin/                                      importer list (filtered by selected env)
/admin/environments                          env CRUD (owner-only)
/admin/importers/new                         create importer (column schema)
/admin/importers/:id                         detail page w/ tabs (see below)
/admin/importers/:id/upload                  5-step wizard to run an upload
/admin/importers/:id/imports/:uploadId       upload detail + retry + errors
/admin/api-keys                              per-importer-env secrets + rotate
/admin/settings                              project name, allowed_email_domain, members, env_grants
/admin/profile                               user email + linked Google account
```

Top nav: `[Project: EVO ▾] [Environment: production ▾]` switchers + user avatar.

### Importer detail page (tabbed)

```
┌─ Importer: Tenants ────────────────────────────────────────────┐
│ [General] [Columns] [Production] [Staging] [UAT]               │
│                                                                 │
│ General  — name, archived                                      │
│ Columns  — shared schema (drag-reorder, add/edit dialog)       │
│ <Env>    — webhook URL, signing toggle + secret, batch_size,   │
│             filter_invalid, include_unmatched, internal key,   │
│             "Run upload" button, imports history (filename,    │
│             status, created, response)                         │
└─────────────────────────────────────────────────────────────────┘
```

### Upload wizard (`/admin/importers/:id/upload`)

Authenticated route. Five steps:

0. **Upload context** (optional) — small form: target environment (defaults to selected env from nav), free-text note, ticket reference, and any extra `user` / `metadata` JSON the dev team wants attached to the webhook payload. `user.userId` auto-fills with the logged-in dev team member's email so Laravel side has audit context.
1. **Upload File** — drag-drop or browse. Accepts `.csv` / `.xlsx` / `.xls` / `.tsv`. Parsed client-side with PapaParse + SheetJS. Default encoding UTF-8.
2. **Match Columns** — fuzzy auto-suggest (Levenshtein on lowercased names); user adjusts dropdowns; validates all required columns are matched before "Next".
3. **Review & Edit** — virtualized grid (TanStack Table) showing parsed rows with per-cell validation status. Errors red, warnings yellow. Filter to "errors only". Inline cell edits re-validate live.
4. **Submit & Progress** — live progress bar via polling `/api/uploads/:id`. When complete: success summary + per-row errors echoed from Laravel + downloadable error CSV.

Client-side parsing means **the source file never leaves the browser unless validation passes** — small privacy win, also matters because client CSVs may contain PII.

### Hono RPC layout

```ts
// apps/worker/src/index.ts
const app = new Hono<{ Bindings: Env }>()
  .route('/api/auth',         authRoutes)         // google sso (login, callback, logout)
  .use('/api/*', requireSession)                  // everything below is auth-gated
  .route('/api/me',           meRoutes)           // session info, project switcher data
  .route('/api/projects',     projectRoutes)      // CRUD + members + invites
  .route('/api/environments', environmentRoutes)  // env CRUD (owner)
  .route('/api/importers',    importerRoutes)     // CRUD + columns
  .route('/api/uploads',      uploadRoutes);      // init, batch ingest, status, retry

export type AppType = typeof app;
```

`apps/web/` imports `AppType` via `import type` and creates the typed client with `hc<AppType>(window.location.origin)`. Only `/api/auth/*` is exempt from `requireSession`. Downstream routes additionally use `withProject` + `withEnvironment` middlewares that compute effective role server-side.

### Multi-tenancy & environment enforcement

Every route under `/api/*` (except `/api/auth/*`) requires a session. On top of that:

1. `requireSession` middleware: reads session cookie → KV → `{ user_id, project_id, environment_id }` → 401 if missing.
2. `withProject` middleware: validates the active project, attaches `effective_role` to context.
3. `withEnvironment` middleware (where relevant): does the same for the selected environment.
4. Every D1 query goes through a thin repo layer that **forces project_id (and env_id where applicable) into WHERE**. The repo never accepts these IDs from request body — only from context.

IDOR attempts (forging `project_id` in body/query) return 404, not 403 — 403 leaks existence.

## Repository layout

pnpm workspace:

```
evo-usecsv/
├── pnpm-workspace.yaml
├── package.json                   # workspace root + scripts (dev, build, deploy, db:*)
├── tsconfig.base.json
├── biome.json                     # lint + format
├── README.md
│
├── apps/
│   ├── worker/                    # Hono on Cloudflare Workers
│   │   ├── src/
│   │   │   ├── index.ts           # Hono app composition + export type AppType
│   │   │   ├── env.ts             # CF bindings type (D1, R2, KV, QUEUE)
│   │   │   ├── middleware/
│   │   │   │   ├── require-session.ts  # 401 if no session
│   │   │   │   ├── with-project.ts
│   │   │   │   └── with-environment.ts
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts        # google sso login/callback/logout
│   │   │   │   ├── me.ts          # session info, project switcher data
│   │   │   │   ├── projects.ts    # CRUD + members + invites + allowed_domain
│   │   │   │   ├── environments.ts
│   │   │   │   ├── importers.ts   # CRUD + columns + per-env config tabs
│   │   │   │   └── uploads.ts     # init, batch ingest, status, retry
│   │   │   ├── db/
│   │   │   │   ├── schema.ts      # Drizzle schema
│   │   │   │   └── repos/         # all queries; every fn takes ids from ctx
│   │   │   ├── queue/
│   │   │   │   ├── webhook-dispatch.ts   # consumer + retry/halt logic
│   │   │   │   └── sign.ts        # HMAC-SHA256 helper
│   │   │   └── lib/{ids,fuzzy-match,validators}.ts
│   │   ├── migrations/            # D1 SQL via drizzle-kit
│   │   ├── wrangler.toml          # bindings + queue producer/consumer + R2 + KV
│   │   └── package.json
│   │
│   └── web/                       # Vite 8 React SPA, served as Worker static assets
│       ├── src/
│       │   ├── main.tsx
│       │   ├── routes/            # TanStack Router (file-based, typed)
│       │   │   ├── __root.tsx
│       │   │   ├── login.tsx                          # unauthed
│       │   │   ├── invites.$token.tsx                 # unauthed; triggers SSO
│       │   │   └── _authed/                           # session-gated layout
│       │   │       └── admin/
│       │   │           ├── index.tsx                  # importer list
│       │   │           ├── environments.tsx
│       │   │           ├── importers.$id.tsx          # detail + tabs
│       │   │           ├── importers.$id.upload.tsx   # 5-step wizard
│       │   │           ├── importers.$id.imports.$uploadId.tsx
│       │   │           ├── api-keys.tsx
│       │   │           ├── settings.tsx
│       │   │           └── profile.tsx
│       │   ├── lib/
│       │   │   ├── api.ts         # hc<AppType>(window.location.origin)
│       │   │   ├── csv-parse.ts   # PapaParse + SheetJS wrapper
│       │   │   └── fuzzy.ts       # column auto-suggest
│       │   ├── components/
│       │   │   ├── upload-wizard/{step-context,step-upload,step-match,step-review,step-progress}.tsx
│       │   │   └── admin/{importer-form,column-dialog,env-tab,members-table,...}.tsx
│       │   └── styles/globals.css                # Tailwind v4
│       ├── index.html
│       ├── vite.config.ts                        # builds to ../worker/static-assets
│       └── package.json
│
├── packages/
│   └── shared/                    # only what Hono RPC can't infer
│       ├── src/
│       │   ├── webhook.ts         # WebhookPayload, WebhookErrorsResponse
│       │   └── queue.ts           # WebhookDispatchJob
│       └── package.json
│
└── tools/
    ├── bootstrap.ts               # seed first owner + project + default env
    ├── seed-evo-importers.ts      # create "Tenants" + "Properties" importers
    │                                with column schemas mirroring Laravel imports
    └── webhook-shape.snapshot.test.ts  # locks payload format
```

### Library choices

| Concern | Pick | Rationale |
|---|---|---|
| Web framework | Hono 4.x | required |
| Worker runtime | Cloudflare Workers | required |
| ORM | Drizzle (`drizzle-orm/d1`) | typed, light, codegen-friendly for D1 |
| Auth | `@hono/oauth-providers/google` | first-party Hono provider |
| HMAC | `@noble/hashes` | WASM-free, Workers-safe |
| Frontend | React 19 + Vite 8 | required |
| Router | TanStack Router | type-safe + plays well with Hono RPC types |
| Server state | TanStack Query | cache + retries on importer flow polling |
| Styling | Tailwind v4 + Radix primitives | minimal runtime, accessible primitives |
| CSV/XLSX parse | PapaParse + SheetJS | client-side, no server upload until validated |
| Tables | TanStack Table + virtualization | review grid must handle 100k rows |
| Fuzzy match | `match-sorter` | tiny, fits column-match suggester |
| IDs | `ulid` internal, `crypto.randomUUID()` public | sortable internal, opaque public |

## Verification plan

| Layer | What it proves | How |
|---|---|---|
| **1. Payload snapshot test** | byte-equal output vs Laravel's existing mocks | `pnpm test webhook-shape` — feeds a canned upload through the dispatch pipeline (mocking only outbound `fetch`), captures the request body, diffs against `evo-laravel-server/tests/Mocks/Imports/Tenants/import-success.json`. Failing this test blocks deploy. |
| **2. Drizzle migrations apply cleanly** | schema + indexes valid on fresh D1 | `pnpm db:migrate` against a throwaway D1 created with `wrangler d1 create`. |
| **3. Local E2E against real Laravel** | full happy path lands rows in Laravel | `pnpm dev:full` boots `wrangler dev` + a `cloudflared tunnel` exposing the local Laravel server. Manually drive: create importer → set webhook URL to tunnel → upload sample CSV → confirm tenant row in Laravel DB. |
| **4. Retry / halt unit tests** | queue consumer behaves on 5xx, timeout, partial errors | Vitest with stubbed fetch; assert `webhook_attempts` rows + final `upload.status`. |
| **5. Multi-tenant isolation** | no IDOR via id substitution | Repo-layer test: every CRUD route with forged `project_id` / `environment_id` in body/query must return 404; missing-session must return 401. |
| **6. Permission matrix** | env_grants computed correctly | Unit tests for `effective_role()` covering each cell in the capability matrix. |
| **7. Google SSO callback** | match / invite / domain-restricted / unauthorized branches | Vitest with mocked `@hono/oauth-providers`; verify the "no match, no invite" branch returns 403 and creates no users row. |
| **8. Bootstrap CLI** | seeds a project + owner + default env idempotently | Run against a throwaway D1: `pnpm bootstrap --email test@example.com --project-slug demo` → assert rows exist; second run with same slug exits 0 without duplicating. |

## Deploy pipeline (MVP)

```bash
pnpm build                  # vite build → apps/worker/static-assets, tsc --noEmit
pnpm db:migrate:prod        # wrangler d1 migrations apply <db> --env=prod
pnpm deploy:prod            # wrangler deploy --env=prod
```

One worker, three environments (`dev` / `staging` / `prod`) with separate D1 + R2 + KV + Queue bindings per env in `wrangler.toml`. Secrets via `wrangler secret put`.

GitHub Actions CI/CD is post-MVP.

## Explicit non-goals for MVP

- Anonymous / public upload URLs (every uploader is authenticated)
- JS/React SDK packages (deferred — internal tool only)
- Client-facing self-service portal
- Languages other than English
- Themes / branding customization
- Magic-link / email-password auth (Google SSO only)
- `onData` callback delivery mode
- Validation hooks (`onRecordsInitial`, `onRecordEdit`)
- Markdown welcome message (plain text only)
- Excel formula evaluation (values only)
- File retention beyond 30 days
- Per-importer rate limits

## Open questions / future work

- Should we add an `X-Evo-Environment` header to the webhook payload for projects that want a single backend to handle all envs? (Trivial to add later; not in MVP.)
- Magic-link auth for external contractors who don't have Google accounts.
- Importer "templates" — shared schemas across projects (for Mohara to onboard other clients with the same property/tenant shape).
- Direct R2 multipart upload for files > 100MB.
- GitHub Actions deploy on tag.

## References

- usecsv official docs: <https://docs.usecsv.com/docs/overview>
- Webhook contract: <https://docs.usecsv.com/docs/webhook>
- npm: [@usecsv/js](https://www.npmjs.com/package/@usecsv/js), [@usecsv/react](https://www.npmjs.com/package/@usecsv/react)
- Live admin (reference account): `app.usecsv.com/admin` (creds in `usecsv-credentials.txt`, gitignored)
- Screenshots of usecsv admin/importer: [usecsv-screenshots/](../../../usecsv-screenshots/)
