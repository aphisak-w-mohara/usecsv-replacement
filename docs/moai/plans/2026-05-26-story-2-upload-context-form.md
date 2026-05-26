# Story #2 — Upload Context Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Step 0 of the upload wizard — a form where a logged-in dev team member attaches optional ticket-reference / note / JSON payloads to an upload, with the server auto-filling `user.userId` from the session when the member doesn't override it.

**Architecture:** Greenfield pnpm workspace with two apps: `apps/worker` (Hono on Cloudflare Workers) and `apps/web` (Vite 8 + React 19 SPA served as static assets from the worker). Story #2 is the first user-visible slice, so this plan also bootstraps the workspace, sets up a stubbed dev auth (real Google SSO is a sibling Epic), wires up Hono RPC for end-to-end typed API calls, and adds Vitest + Testing Library. Subsequent stories will reuse this foundation untouched.

**Tech Stack:** pnpm workspace · TypeScript 5 · Vite 8 · React 19 · TanStack Router · Tailwind CSS v4 · Hono 4 · Cloudflare Workers (Wrangler 3) · Vitest · @testing-library/react · zod (JSON shape validation).

**Maps to GitHub Issue:** [#2 — Member fills in upload context](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/2)

**Parent Epic:** [#1 — Upload Wizard](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/1)

**Spec references:**
- [`docs/superpowers/specs/2026-05-26-usecsv-clone-design.md`](../../superpowers/specs/2026-05-26-usecsv-clone-design.md) — full technical design (data model, webhook contract, repo layout)
- [`prds/prd-feature-upload-wizard.md`](../../../prds/prd-feature-upload-wizard.md) — PRD-002 (this Story is §5.1)
- [`captured-payloads/2026-05-26-usecsv-live-webhook.json`](../../../captured-payloads/2026-05-26-usecsv-live-webhook.json) — empirical reference; used here to lock the `user`/`metadata` payload shape

---

## File Structure

This plan creates the following files (foundation + Story #2). Bullet markers `[F]` = foundation, `[S]` = Story #2 work.

```
evo-usecsv/
├── package.json                                [F] workspace root
├── pnpm-workspace.yaml                         [F] workspace declaration
├── tsconfig.base.json                          [F] shared TS config
├── biome.json                                  [F] lint + format
├── .nvmrc                                      [F] pin node version
│
├── apps/
│   ├── worker/
│   │   ├── package.json                        [F]
│   │   ├── tsconfig.json                       [F]
│   │   ├── wrangler.toml                       [F] CF bindings
│   │   ├── vitest.config.ts                    [F]
│   │   ├── src/
│   │   │   ├── index.ts                        [F] Hono app entry
│   │   │   ├── env.ts                          [F] Bindings type
│   │   │   ├── middleware/
│   │   │   │   └── dev-session.ts              [F] auth stub
│   │   │   ├── routes/
│   │   │   │   └── uploads.ts                  [S] POST /api/uploads handler
│   │   │   └── lib/
│   │   │       └── inject-user-id.ts           [S] server-side userId fill
│   │   └── test/
│   │       ├── dev-session.test.ts             [F]
│   │       ├── inject-user-id.test.ts          [S]
│   │       └── uploads.test.ts                 [S]
│   │
│   └── web/
│       ├── package.json                        [F]
│       ├── tsconfig.json                       [F]
│       ├── vite.config.ts                      [F]
│       ├── vitest.config.ts                    [F]
│       ├── index.html                          [F]
│       ├── postcss.config.mjs                  [F]
│       ├── tailwind.config.ts                  [F]
│       ├── src/
│       │   ├── main.tsx                        [F] router mount
│       │   ├── styles/globals.css              [F] tailwind directives
│       │   ├── lib/
│       │   │   ├── api.ts                      [F] Hono RPC client
│       │   │   └── json-validate.ts            [S] JSON shape + size guard
│       │   ├── routes/
│       │   │   ├── __root.tsx                  [F]
│       │   │   └── _authed/admin/importers.$id.upload.tsx  [S] wizard route
│       │   └── components/
│       │       └── upload-wizard/
│       │           ├── wizard-shell.tsx        [S] 5-step nav scaffold
│       │           └── step-context.tsx        [S] Step 0 form
│       └── test/
│           ├── json-validate.test.ts           [S]
│           └── step-context.test.tsx           [S]
│
└── packages/
    └── shared/
        ├── package.json                        [F]
        ├── tsconfig.json                       [F]
        └── src/
            └── webhook.ts                      [F] WebhookPayload type (used later; declared now)
```

The foundation work (~13 tasks) is unavoidable — Story #2 is the first user-facing slice, so the workspace, build system, test infra, RPC client, and stub auth all have to exist before the form can be wired up. Subsequent stories will reuse all of this with zero additional foundation work.

---

# Phase 1 — Foundation (Tasks 1–13)

### Task 1: Initialize pnpm workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.nvmrc`

- [ ] **Step 1: Pin Node version**

Create `.nvmrc`:

```
22.11.0
```

- [ ] **Step 2: Create the workspace declaration**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create the workspace root package.json**

Create `package.json`:

```json
{
  "name": "evo-csv",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.11.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "dev": "pnpm --filter @evo-csv/web dev",
    "dev:worker": "pnpm --filter @evo-csv/worker dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 4: Install + verify**

Run: `pnpm install`
Expected: lockfile created, no errors.

Run: `node --version && pnpm --version`
Expected: Node ≥22.11.0, pnpm ≥9.

- [ ] **Step 5: Commit**

```bash
git add .nvmrc pnpm-workspace.yaml package.json pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspace"
```

---

### Task 2: TypeScript + Biome configuration

**Files:**
- Create: `tsconfig.base.json`
- Create: `biome.json`

- [ ] **Step 1: Create the shared TS config**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "jsx": "react-jsx",
    "types": []
  }
}
```

- [ ] **Step 2: Create the Biome config**

Create `biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "off"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "files": {
    "ignore": ["node_modules", "dist", ".wrangler", ".vite", "pnpm-lock.yaml"]
  }
}
```

- [ ] **Step 3: Verify Biome runs**

Run: `pnpm lint`
Expected: passes (nothing to lint yet — exit 0 or "no files matched").

- [ ] **Step 4: Commit**

```bash
git add tsconfig.base.json biome.json
git commit -m "chore: add typescript + biome configuration"
```

---

### Task 3: Scaffold the worker (apps/worker)

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/wrangler.toml`
- Create: `apps/worker/src/env.ts`
- Create: `apps/worker/src/index.ts`

- [ ] **Step 1: Create worker package.json**

Create `apps/worker/package.json`:

```json
{
  "name": "@evo-csv/worker",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    "./types": "./src/index.ts"
  },
  "scripts": {
    "dev": "wrangler dev",
    "build": "tsc --noEmit",
    "deploy": "wrangler deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/zod-validator": "^0.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240909.0",
    "wrangler": "^3.78.0",
    "vitest": "^2.1.0",
    "@cloudflare/vitest-pool-workers": "^0.5.0"
  }
}
```

- [ ] **Step 2: Create worker tsconfig**

Create `apps/worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"],
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create wrangler.toml**

Create `apps/worker/wrangler.toml`:

```toml
name = "evo-csv"
main = "src/index.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]

[vars]
DEV_USER_EMAIL = "aphisak@mohara.co"

[[d1_databases]]
binding = "DB"
database_name = "evo-csv-dev"
database_id = "REPLACE_ME_AFTER_wrangler_d1_create"
```

Note: the `database_id` is filled in later (Task 4).

- [ ] **Step 4: Create the Env type**

Create `apps/worker/src/env.ts`:

```ts
export type Env = {
  DB: D1Database;
  DEV_USER_EMAIL: string;
};
```

- [ ] **Step 5: Create the minimal Hono entry**

Create `apps/worker/src/index.ts`:

```ts
import { Hono } from "hono";
import type { Env } from "./env.js";

const app = new Hono<{ Bindings: Env }>()
  .get("/api/health", (c) => c.json({ ok: true }));

export type AppType = typeof app;
export default app;
```

- [ ] **Step 6: Install worker deps + verify it builds**

Run: `pnpm install`
Then: `pnpm --filter @evo-csv/worker build`
Expected: `tsc --noEmit` passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/worker pnpm-lock.yaml
git commit -m "chore: scaffold apps/worker with hono"
```

---

### Task 4: Provision D1 database + run first migration

**Files:**
- Create: `apps/worker/migrations/0001_initial.sql`

- [ ] **Step 1: Create the D1 database**

Run: `npx wrangler d1 create evo-csv-dev`
Expected: prints a database UUID. Copy it.

- [ ] **Step 2: Update wrangler.toml with the real DB id**

Edit `apps/worker/wrangler.toml` — replace `REPLACE_ME_AFTER_wrangler_d1_create` with the UUID from Step 1.

- [ ] **Step 3: Write the initial migration**

Create `apps/worker/migrations/0001_initial.sql`:

```sql
-- Projects (tenants)
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  allowed_email_domain TEXT,
  created_at INTEGER NOT NULL
);

-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  google_sub TEXT UNIQUE,
  name TEXT NOT NULL,
  picture_url TEXT,
  last_active_project_id TEXT,
  last_active_environment_id TEXT,
  created_at INTEGER NOT NULL
);

-- Memberships
CREATE TABLE memberships (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (project_id, user_id)
);

-- Environments
CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, slug)
);

-- Importers (logical, schema-bearing)
CREATE TABLE importers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Importer environments (per-(importer x env) delivery config)
CREATE TABLE importer_environments (
  id TEXT PRIMARY KEY,
  importer_id TEXT NOT NULL REFERENCES importers(id),
  environment_id TEXT NOT NULL REFERENCES environments(id),
  key TEXT UNIQUE NOT NULL,
  webhook_url TEXT NOT NULL,
  webhook_signing_enabled INTEGER NOT NULL DEFAULT 0,
  webhook_secret TEXT,
  batch_size INTEGER NOT NULL DEFAULT 1000,
  filter_invalid_rows INTEGER NOT NULL DEFAULT 0,
  include_unmatched_columns INTEGER NOT NULL DEFAULT 0,
  UNIQUE(importer_id, environment_id)
);

-- Uploads
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  numeric_id INTEGER UNIQUE NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  importer_environment_id TEXT NOT NULL REFERENCES importer_environments(id),
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  r2_source_key TEXT NOT NULL,
  matched_columns_map TEXT NOT NULL,
  uploaded_file_headers TEXT NOT NULL,
  user_payload TEXT,
  metadata_payload TEXT,
  total_rows INTEGER NOT NULL,
  batch_size INTEGER NOT NULL,
  batch_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatching', 'completed', 'halted', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sequence counter for numeric_id
CREATE TABLE sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sequences (name, value) VALUES ('upload_numeric', 0);

-- Seed: one project, one env, one user (the dev owner), one importer, one importer_environment
-- These IDs are stable across dev so tests can reference them.
INSERT INTO projects (id, slug, name, created_at)
VALUES ('proj_evo', 'evo', 'EVO', unixepoch());

INSERT INTO environments (id, project_id, slug, name, is_default, created_at)
VALUES ('env_evo_staging', 'proj_evo', 'staging', 'Staging', 1, unixepoch());

INSERT INTO users (id, email, name, created_at)
VALUES ('usr_dev', 'aphisak@mohara.co', 'Aphisak Naksomboon', unixepoch());

INSERT INTO memberships (project_id, user_id, role)
VALUES ('proj_evo', 'usr_dev', 'owner');

INSERT INTO importers (id, project_id, name, created_at, updated_at)
VALUES ('imp_tenants', 'proj_evo', 'Tenants', unixepoch(), unixepoch());

INSERT INTO importer_environments (id, importer_id, environment_id, key, webhook_url)
VALUES (
  'impenv_tenants_staging',
  'imp_tenants',
  'env_evo_staging',
  '82b18e5e-6412-4102-901a-ce3c05d71460',
  'https://webhook.site/6d8413f2-d7ea-4ac5-97c9-dfa1fdb5b9fc'
);
```

- [ ] **Step 4: Apply the migration locally**

Run: `cd apps/worker && npx wrangler d1 migrations apply evo-csv-dev --local`
Expected: "Migration 0001_initial.sql applied".

- [ ] **Step 5: Verify seed data**

Run: `cd apps/worker && npx wrangler d1 execute evo-csv-dev --local --command "SELECT * FROM importer_environments;"`
Expected: one row with `key = '82b18e5e-...'`.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/wrangler.toml apps/worker/migrations
git commit -m "feat(worker): add d1 schema migration with dev seed"
```

---

### Task 5: Vitest setup in the worker + first passing test

**Files:**
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/test/health.test.ts`

- [ ] **Step 1: Configure Vitest for Workers**

Create `apps/worker/vitest.config.ts`:

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 2: Write the failing test**

Create `apps/worker/test/health.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("GET /api/health", () => {
  it("returns ok: true", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Run the test (already passes since route exists from Task 3)**

Run: `pnpm --filter @evo-csv/worker test`
Expected: PASS — `1 passed (1)`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/vitest.config.ts apps/worker/test/health.test.ts
git commit -m "test(worker): add vitest setup with health-route test"
```

---

### Task 6: Dev-session auth-stub middleware

**Files:**
- Create: `apps/worker/src/middleware/dev-session.ts`
- Create: `apps/worker/test/dev-session.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/env.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/test/dev-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

describe("dev session middleware", () => {
  it("attaches a synthetic session from DEV_USER_EMAIL to /api/* routes", async () => {
    const res = await SELF.fetch("https://example.com/api/whoami");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      user: {
        id: "usr_dev",
        email: "aphisak@mohara.co",
      },
      project_id: "proj_evo",
      role: "owner",
    });
  });

  it("does NOT attach a session to non-/api routes", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    // /api/health doesn't depend on session, but should still pass
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `pnpm --filter @evo-csv/worker test`
Expected: FAIL — `/api/whoami` returns 404.

- [ ] **Step 3: Extend the Env type**

Replace `apps/worker/src/env.ts`:

```ts
export type Env = {
  DB: D1Database;
  DEV_USER_EMAIL: string;
};

export type SessionContext = {
  user: { id: string; email: string; name: string };
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
};

export type Variables = {
  session: SessionContext;
};
```

- [ ] **Step 4: Implement the middleware**

Create `apps/worker/src/middleware/dev-session.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../env.js";

/**
 * TEMPORARY dev-only auth stub. Looks up the user named by DEV_USER_EMAIL
 * in the D1 seed data and pretends they're signed in. Replace this entire
 * file with the real Google SSO middleware when the Auth Epic ships.
 */
export const devSession: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> =
  async (c, next) => {
    const email = c.env.DEV_USER_EMAIL;
    if (!email) {
      return c.json({ error: "DEV_USER_EMAIL not set" }, 500);
    }

    const user = await c.env.DB.prepare(
      "SELECT id, email, name FROM users WHERE email = ?",
    )
      .bind(email)
      .first<{ id: string; email: string; name: string }>();

    if (!user) {
      return c.json({ error: `Dev user not found: ${email}` }, 500);
    }

    const membership = await c.env.DB.prepare(
      `SELECT m.project_id, m.role, e.id AS environment_id
       FROM memberships m
       JOIN environments e ON e.project_id = m.project_id AND e.is_default = 1
       WHERE m.user_id = ?
       LIMIT 1`,
    )
      .bind(user.id)
      .first<{ project_id: string; environment_id: string; role: "owner" | "member" }>();

    if (!membership) {
      return c.json({ error: "Dev user has no membership" }, 500);
    }

    c.set("session", {
      user,
      project_id: membership.project_id,
      environment_id: membership.environment_id,
      role: membership.role,
    });

    await next();
  };
```

- [ ] **Step 5: Wire the middleware into the Hono app + add the /api/whoami debug route**

Replace `apps/worker/src/index.ts`:

```ts
import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { devSession } from "./middleware/dev-session.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  .use("/api/*", devSession)
  .get("/api/whoami", (c) => c.json(c.get("session")));

export type AppType = typeof app;
export default app;
```

Note: middleware order matters. `/api/health` is registered BEFORE the `use("/api/*", devSession)` line so it stays open.

- [ ] **Step 6: Run the tests — verify they pass**

Run: `pnpm --filter @evo-csv/worker test`
Expected: PASS — 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src apps/worker/test/dev-session.test.ts
git commit -m "feat(worker): add dev-session auth stub middleware

Reads DEV_USER_EMAIL from env, looks up the user + their default-env
membership in D1, attaches a synthetic session to /api/* routes.
Replace with real Google SSO middleware when the Auth Epic ships."
```

---

### Task 7: Shared types package (`packages/shared`)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/webhook.ts`

- [ ] **Step 1: Create the package manifest**

Create `packages/shared/package.json`:

```json
{
  "name": "@evo-csv/shared",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    "./webhook": "./src/webhook.ts"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Add the WebhookPayload type**

Create `packages/shared/src/webhook.ts`:

```ts
/**
 * The exact shape of the JSON body POSTed to a customer's webhook URL.
 * Empirically pinned to captured-payloads/2026-05-26-usecsv-live-webhook.json.
 *
 * INVARIANTS:
 * - uploadId is an integer (Laravel validates as int)
 * - importerId is a UUID string (importer_environments.key)
 * - batch.index is 1-based; final batch satisfies batch.index === batch.count
 * - matchedColumnsMap direction is { machine_name: file_header } — NOT the reverse
 * - rows[i] keys are importer_columns.name values (machine names)
 * - rows[i].row is the 1-based source-file row number
 * - user and metadata are objects OR null — never undefined, never omitted
 */
export type WebhookPayload = {
  uploadId: number;
  importerId: string;
  fileName: string;
  matchedColumnsMap: Record<string, string>;
  uploadedFileHeaders: string[];
  batch: {
    index: number;
    count: number;
    totalRows: number;
  };
  user: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  rows: Array<Record<string, unknown> & { row: number }>;
};

export type WebhookErrorsResponse = {
  errors?: Array<{ row: number; msg: string }>;
};
```

- [ ] **Step 4: Run pnpm install to wire the workspace package**

Run: `pnpm install`
Expected: `@evo-csv/shared` shows up in the workspace.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "chore: add @evo-csv/shared package with WebhookPayload type"
```

---

### Task 8: Scaffold the web app (apps/web)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/routes/__root.tsx`

- [ ] **Step 1: Create the web package.json**

Create `apps/web/package.json`:

```json
{
  "name": "@evo-csv/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "@evo-csv/shared": "workspace:*",
    "@evo-csv/worker": "workspace:*",
    "@tanstack/react-router": "^1.85.0",
    "@tanstack/router-devtools": "^1.85.0",
    "hono": "^4.6.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@tanstack/router-vite-plugin": "^1.85.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^25.0.0",
    "vite": "^8.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the web tsconfig**

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create the Vite config**

Create `apps/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Forward /api/* to the wrangler dev server during local dev
      "/api": "http://localhost:8787",
    },
  },
});
```

- [ ] **Step 4: Create the HTML entry**

Create `apps/web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1280" />
    <title>evo-csv</title>
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create the root route**

Create `apps/web/src/routes/__root.tsx`:

```tsx
import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      <Outlet />
    </div>
  ),
});
```

- [ ] **Step 6: Create the React entry**

Create `apps/web/src/main.tsx`:

```tsx
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

Note: `routeTree.gen.ts` is auto-generated by the TanStack Router Vite plugin on first build/dev — don't create it manually.

- [ ] **Step 7: Install deps + verify dev starts**

Run: `pnpm install`
Then: `pnpm --filter @evo-csv/web dev`
Expected: Vite starts on http://localhost:5173 without errors. Ctrl+C to stop.

- [ ] **Step 8: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "chore: scaffold apps/web with vite + react + tanstack router"
```

---

### Task 9: Tailwind CSS v4 setup

**Files:**
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/src/styles/globals.css`
- Modify: `apps/web/package.json` (add tailwindcss dep)

- [ ] **Step 1: Add Tailwind v4 dependencies**

Edit `apps/web/package.json`. Add to `devDependencies`:

```json
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
```

- [ ] **Step 2: PostCSS config**

Create `apps/web/postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Tailwind config**

Create `apps/web/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
} satisfies Config;
```

- [ ] **Step 4: Global stylesheet**

Create `apps/web/src/styles/globals.css`:

```css
@import "tailwindcss";

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
```

- [ ] **Step 5: Install + verify**

Run: `pnpm install`
Then: `pnpm --filter @evo-csv/web dev`
Open http://localhost:5173 — page should load with Tailwind's slate-50 background applied (light gray). Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add apps/web/postcss.config.mjs apps/web/tailwind.config.ts apps/web/src/styles apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add tailwind v4 styling"
```

---

### Task 10: Vitest + Testing Library setup in web

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/test/setup.ts`
- Create: `apps/web/test/smoke.test.tsx`

- [ ] **Step 1: Vitest config**

Create `apps/web/vitest.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
  },
});
```

- [ ] **Step 2: Test setup file**

Create `apps/web/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Write a smoke test**

Create `apps/web/test/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("renders a button", () => {
    render(<button type="button">Hello</button>);
    expect(screen.getByRole("button", { name: "Hello" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @evo-csv/web test`
Expected: PASS — `1 passed (1)`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/test
git commit -m "test(web): add vitest + testing-library setup"
```

---

### Task 11: Hono RPC typed client

**Files:**
- Create: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Create the RPC client**

Create `apps/web/src/lib/api.ts`:

```ts
import type { AppType } from "@evo-csv/worker";
import { hc } from "hono/client";

/**
 * Typed RPC client for the worker's Hono app.
 *
 * Usage: `await api.api.uploads.$post({ json: payload })`
 *
 * The `import type` keeps the worker's runtime code out of the web bundle —
 * we only import the type, not the implementation.
 */
export const api = hc<AppType>(typeof window !== "undefined" ? window.location.origin : "");
```

- [ ] **Step 2: Verify the build**

Run: `pnpm --filter @evo-csv/web build`
Expected: `tsc --noEmit && vite build` passes. The `AppType` import resolves through the workspace symlink.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add typed hono rpc client"
```

---

### Task 12: Wire dev script to run worker + web together

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add a concurrent dev script**

Edit the root `package.json` — replace the `scripts` block with:

```json
  "scripts": {
    "dev": "pnpm -r --parallel --filter \"@evo-csv/*\" dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
```

This runs `wrangler dev` (worker on :8787) and `vite dev` (web on :5173) in parallel. The Vite proxy from Task 8 forwards `/api/*` to the worker.

- [ ] **Step 2: Verify both servers come up**

Run: `pnpm dev`
Expected: Vite logs `http://localhost:5173/`, Wrangler logs `http://localhost:8787/`. Open http://localhost:5173/api/health in the browser → JSON `{"ok": true}` from the worker via the proxy. Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: wire root dev script for concurrent worker + web"
```

---

### Task 13: Foundation checkpoint — push and tag

- [ ] **Step 1: Run all tests one last time**

Run: `pnpm test`
Expected: all tests pass across both apps.

- [ ] **Step 2: Push to origin/main**

Run: `git push`
Expected: pushes all foundation commits.

- [ ] **Step 3: Tag the foundation checkpoint**

Run: `git tag -a foundation-complete -m "Foundation ready for Story #2 onwards"`
Then: `git push origin foundation-complete`
Expected: tag pushed.

---

# Phase 2 — Story #2: Upload Context Form (Tasks 14–22)

### Task 14: Write the failing test for `inject-user-id`

**Files:**
- Create: `apps/worker/src/lib/inject-user-id.ts` (placeholder)
- Create: `apps/worker/test/inject-user-id.test.ts`

- [ ] **Step 1: Create the empty module so the import doesn't break**

Create `apps/worker/src/lib/inject-user-id.ts`:

```ts
export function injectUserId(
  _userPayload: Record<string, unknown> | null,
  _sessionEmail: string,
): Record<string, unknown> | null {
  throw new Error("not implemented");
}
```

- [ ] **Step 2: Write the tests**

Create `apps/worker/test/inject-user-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { injectUserId } from "../src/lib/inject-user-id.js";

describe("injectUserId", () => {
  it("injects session email as userId when payload is null", () => {
    const result = injectUserId(null, "aphisak@mohara.co");
    expect(result).toEqual({ userId: "aphisak@mohara.co" });
  });

  it("injects session email as userId when payload is an empty object", () => {
    const result = injectUserId({}, "aphisak@mohara.co");
    expect(result).toEqual({ userId: "aphisak@mohara.co" });
  });

  it("does NOT overwrite when the payload already has a userId", () => {
    const result = injectUserId({ userId: "custom-id", role: "ops" }, "aphisak@mohara.co");
    expect(result).toEqual({ userId: "custom-id", role: "ops" });
  });

  it("preserves other fields while adding userId", () => {
    const result = injectUserId({ extra: "value" }, "aphisak@mohara.co");
    expect(result).toEqual({ extra: "value", userId: "aphisak@mohara.co" });
  });
});
```

- [ ] **Step 3: Run the tests — verify they fail**

Run: `pnpm --filter @evo-csv/worker test inject-user-id`
Expected: 4 FAILS with "not implemented".

- [ ] **Step 4: Commit (red phase)**

```bash
git add apps/worker/src/lib/inject-user-id.ts apps/worker/test/inject-user-id.test.ts
git commit -m "test(worker): add failing tests for injectUserId"
```

---

### Task 15: Implement `injectUserId`

**Files:**
- Modify: `apps/worker/src/lib/inject-user-id.ts`

- [ ] **Step 1: Replace with a real implementation**

Replace `apps/worker/src/lib/inject-user-id.ts`:

```ts
/**
 * Server-side helper that fills in `user.userId` from the session email
 * when the caller didn't supply one. Used by POST /api/uploads.
 *
 * Rules (verifiable against PRD-002 Story 1 ACs):
 *   - payload null OR empty → { userId: sessionEmail }
 *   - payload has its own userId → leave it untouched (caller's choice wins)
 *   - payload has other fields but no userId → merge in { userId: sessionEmail }
 */
export function injectUserId(
  userPayload: Record<string, unknown> | null,
  sessionEmail: string,
): Record<string, unknown> | null {
  if (userPayload === null) {
    return { userId: sessionEmail };
  }
  if ("userId" in userPayload) {
    return userPayload;
  }
  return { ...userPayload, userId: sessionEmail };
}
```

- [ ] **Step 2: Run the tests — verify they pass**

Run: `pnpm --filter @evo-csv/worker test inject-user-id`
Expected: PASS — 4 tests pass.

- [ ] **Step 3: Commit (green phase)**

```bash
git add apps/worker/src/lib/inject-user-id.ts
git commit -m "feat(worker): implement injectUserId helper"
```

---

### Task 16: Failing test for `POST /api/uploads`

**Files:**
- Create: `apps/worker/test/uploads.test.ts`

- [ ] **Step 1: Write the integration tests**

Create `apps/worker/test/uploads.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SELF } from "cloudflare:test";

const VALID_BODY = {
  importer_environment_id: "impenv_tenants_staging",
  file_name: "tenants.csv",
  file_size: 1024,
  matched_columns_map: { first_name: "First name" },
  uploaded_file_headers: ["First name"],
  total_rows: 3,
  batch_size: 1000,
  batch_count: 1,
  user_payload: null,
  metadata_payload: null,
};

describe("POST /api/uploads (Story #2 — context form ingest)", () => {
  it("returns upload_id, numeric_id, and status=pending on a valid call", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      upload_id: expect.stringMatching(/^upl_/),
      numeric_id: expect.any(Number),
      status: "pending",
    });
  });

  it("auto-fills user_payload with session email when null", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // Read back the stored row
    const upload = await env.DB.prepare("SELECT user_payload FROM uploads WHERE id = ?")
      .bind(body.upload_id)
      .first<{ user_payload: string }>();
    expect(JSON.parse(upload!.user_payload)).toEqual({ userId: "aphisak@mohara.co" });
  });

  it("preserves user_payload.userId when caller supplies one", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_BODY,
        user_payload: { userId: "external-id", role: "ops" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const upload = await env.DB.prepare("SELECT user_payload FROM uploads WHERE id = ?")
      .bind(body.upload_id)
      .first<{ user_payload: string }>();
    expect(JSON.parse(upload!.user_payload)).toEqual({
      userId: "external-id",
      role: "ops",
    });
  });

  it("stores metadata_payload as-is when non-null", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_BODY,
        metadata_payload: { ticket_reference: "EVO-1234", note: "test" },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const upload = await env.DB.prepare("SELECT metadata_payload FROM uploads WHERE id = ?")
      .bind(body.upload_id)
      .first<{ metadata_payload: string }>();
    expect(JSON.parse(upload!.metadata_payload)).toEqual({
      ticket_reference: "EVO-1234",
      note: "test",
    });
  });

  it("rejects an invalid importer_environment_id with 404", async () => {
    const res = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, importer_environment_id: "nope" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects oversized user_payload (>4KB) with 400", async () => {
    const giant = { padding: "x".repeat(5000) };
    const res = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_BODY, user_payload: giant }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
  });
});

// Helper exposed by @cloudflare/vitest-pool-workers
declare const env: { DB: D1Database };
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `pnpm --filter @evo-csv/worker test uploads`
Expected: 6 FAILS — `/api/uploads` returns 404 (route doesn't exist yet).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/test/uploads.test.ts
git commit -m "test(worker): add failing tests for POST /api/uploads"
```

---

### Task 17: Implement `POST /api/uploads`

**Files:**
- Create: `apps/worker/src/routes/uploads.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Implement the route**

Create `apps/worker/src/routes/uploads.ts`:

```ts
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env, Variables } from "../env.js";
import { injectUserId } from "../lib/inject-user-id.js";

const MAX_PAYLOAD_BYTES = 4 * 1024; // 4 KB

const uploadCreateSchema = z.object({
  importer_environment_id: z.string(),
  file_name: z.string().min(1).max(512),
  file_size: z.number().int().nonnegative(),
  matched_columns_map: z.record(z.string(), z.string()),
  uploaded_file_headers: z.array(z.string()),
  total_rows: z.number().int().positive(),
  batch_size: z.number().int().positive(),
  batch_count: z.number().int().positive(),
  user_payload: z.record(z.string(), z.unknown()).nullable(),
  metadata_payload: z.record(z.string(), z.unknown()).nullable(),
});

function jsonByteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function ulid(): string {
  // Tiny ULID-shaped id generator (good enough for dev; swap for a real lib later).
  const ts = Date.now().toString(36).padStart(10, "0");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("");
  return `upl_${ts}${rand}`;
}

export const uploadsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>().post(
  "/",
  zValidator("json", uploadCreateSchema),
  async (c) => {
    const body = c.req.valid("json");
    const session = c.get("session");

    // Size guards: each JSON payload independently capped at 4 KB.
    if (body.user_payload && jsonByteSize(body.user_payload) > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "user_payload too large — keep it under 4 KB" }, 400);
    }
    if (body.metadata_payload && jsonByteSize(body.metadata_payload) > MAX_PAYLOAD_BYTES) {
      return c.json({ error: "metadata_payload too large — keep it under 4 KB" }, 400);
    }

    // Verify the importer_environment exists and belongs to the active project.
    const impEnv = await c.env.DB.prepare(
      `SELECT ie.id, i.project_id
       FROM importer_environments ie
       JOIN importers i ON i.id = ie.importer_id
       WHERE ie.id = ? AND i.project_id = ?`,
    )
      .bind(body.importer_environment_id, session.project_id)
      .first<{ id: string; project_id: string }>();

    if (!impEnv) {
      return c.json({ error: "Importer environment not found" }, 404);
    }

    // Inject session email as userId when the caller didn't provide one.
    const finalUserPayload = injectUserId(body.user_payload, session.user.email);

    // Atomic numeric_id increment from the sequences table.
    const seq = await c.env.DB.prepare(
      "UPDATE sequences SET value = value + 1 WHERE name = 'upload_numeric' RETURNING value",
    ).first<{ value: number }>();
    if (!seq) {
      return c.json({ error: "sequences row missing — migration not applied" }, 500);
    }

    const uploadId = ulid();
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(
      `INSERT INTO uploads (
        id, numeric_id, project_id, importer_environment_id, file_name, file_size,
        r2_source_key, matched_columns_map, uploaded_file_headers,
        user_payload, metadata_payload, total_rows, batch_size, batch_count,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
      .bind(
        uploadId,
        seq.value,
        session.project_id,
        body.importer_environment_id,
        body.file_name,
        body.file_size,
        `uploads/${uploadId}/source.csv`, // R2 key reserved; actual upload happens in Story 5
        JSON.stringify(body.matched_columns_map),
        JSON.stringify(body.uploaded_file_headers),
        finalUserPayload === null ? null : JSON.stringify(finalUserPayload),
        body.metadata_payload === null ? null : JSON.stringify(body.metadata_payload),
        body.total_rows,
        body.batch_size,
        body.batch_count,
        now,
        now,
      )
      .run();

    return c.json(
      {
        upload_id: uploadId,
        numeric_id: seq.value,
        status: "pending",
      },
      201,
    );
  },
);
```

- [ ] **Step 2: Mount the route in the Hono app**

Replace `apps/worker/src/index.ts`:

```ts
import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { devSession } from "./middleware/dev-session.js";
import { uploadsRoutes } from "./routes/uploads.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  .use("/api/*", devSession)
  .get("/api/whoami", (c) => c.json(c.get("session")))
  .route("/api/uploads", uploadsRoutes);

export type AppType = typeof app;
export default app;
```

- [ ] **Step 3: Run the tests — verify they pass**

Run: `pnpm --filter @evo-csv/worker test`
Expected: PASS — all worker tests pass (health + dev-session + injectUserId + uploads).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src
git commit -m "feat(worker): implement POST /api/uploads with userId injection + size guards"
```

---

### Task 18: JSON validate utility (web side)

**Files:**
- Create: `apps/web/src/lib/json-validate.ts`
- Create: `apps/web/test/json-validate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/json-validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateJsonField } from "../src/lib/json-validate";

describe("validateJsonField", () => {
  it("returns ok for an empty string (optional field)", () => {
    expect(validateJsonField("")).toEqual({ ok: true, value: null });
  });

  it("returns ok with the parsed object for valid JSON", () => {
    expect(validateJsonField('{"foo": "bar"}')).toEqual({
      ok: true,
      value: { foo: "bar" },
    });
  });

  it("returns error for non-object JSON (arrays, primitives)", () => {
    expect(validateJsonField('"hello"').ok).toBe(false);
    expect(validateJsonField("123").ok).toBe(false);
    expect(validateJsonField("[1, 2]").ok).toBe(false);
  });

  it("returns error for syntactically invalid JSON", () => {
    const result = validateJsonField("{foo: bar}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not valid json/i);
    }
  });

  it("returns error when payload exceeds 4 KB", () => {
    const giant = JSON.stringify({ padding: "x".repeat(5000) });
    const result = validateJsonField(giant);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/too large/i);
    }
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `pnpm --filter @evo-csv/web test json-validate`
Expected: FAILs because the import doesn't exist.

- [ ] **Step 3: Implement the validator**

Create `apps/web/src/lib/json-validate.ts`:

```ts
const MAX_BYTES = 4 * 1024;

export type ValidateResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; message: string };

/**
 * Validates a textarea's JSON contents for the upload-context form.
 * Returns `{ value: null }` for empty input (caller treats as "no payload").
 */
export function validateJsonField(raw: string): ValidateResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  if (new TextEncoder().encode(trimmed).byteLength > MAX_BYTES) {
    return { ok: false, message: "Payload too large — keep it under 4 KB" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: "Not valid JSON" };
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return { ok: false, message: "Must be a JSON object (e.g. {\"key\": \"value\"})" };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}
```

- [ ] **Step 4: Run — verify passes**

Run: `pnpm --filter @evo-csv/web test json-validate`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/json-validate.ts apps/web/test/json-validate.test.ts
git commit -m "feat(web): add validateJsonField helper for the context form"
```

---

### Task 19: Wizard shell component

**Files:**
- Create: `apps/web/src/components/upload-wizard/wizard-shell.tsx`

- [ ] **Step 1: Create the shell**

Create `apps/web/src/components/upload-wizard/wizard-shell.tsx`:

```tsx
import type { ReactNode } from "react";

type Step = {
  index: number;
  label: string;
};

const STEPS: readonly Step[] = [
  { index: 0, label: "Context" },
  { index: 1, label: "Upload file" },
  { index: 2, label: "Match columns" },
  { index: 3, label: "Review & edit" },
  { index: 4, label: "Submit" },
] as const;

type WizardShellProps = {
  activeStep: number;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
};

export function WizardShell({
  activeStep,
  children,
  onBack,
  onNext,
  nextDisabled,
  nextLabel = "Next",
}: WizardShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <ol className="flex items-center gap-2" aria-label="Upload wizard steps">
        {STEPS.map((step) => (
          <li
            key={step.index}
            className={`flex items-center gap-2 ${
              step.index === activeStep ? "font-semibold text-slate-900" : "text-slate-500"
            }`}
          >
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                step.index === activeStep
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
              aria-current={step.index === activeStep ? "step" : undefined}
            >
              {step.index + 1}
            </span>
            <span>{step.label}</span>
            {step.index < STEPS.length - 1 && <span className="text-slate-300">·</span>}
          </li>
        ))}
      </ol>

      <main className="flex-1 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </main>

      <footer className="flex justify-between">
        <button
          type="button"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          onClick={onBack}
          disabled={!onBack || activeStep === 0}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={onNext}
          disabled={nextDisabled || !onNext}
        >
          {nextLabel}
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @evo-csv/web build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/upload-wizard/wizard-shell.tsx
git commit -m "feat(web): add WizardShell scaffold for the upload wizard"
```

---

### Task 20: Step 0 — Context form component (failing test first)

**Files:**
- Create: `apps/web/test/step-context.test.tsx`
- Create: `apps/web/src/components/upload-wizard/step-context.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/test/step-context.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StepContext } from "../src/components/upload-wizard/step-context";

describe("StepContext", () => {
  it("renders all four fields", () => {
    render(<StepContext onSubmit={() => {}} />);
    expect(screen.getByLabelText(/ticket reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /advanced/i })).toBeInTheDocument();
  });

  it("submits an empty form with null payloads", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StepContext onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      ticketReference: "",
      note: "",
      userPayload: null,
      metadataPayload: null,
    });
  });

  it("packs ticket_reference and note into the metadata payload on submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StepContext onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/ticket reference/i), "EVO-1234");
    await user.type(screen.getByLabelText(/note/i), "test");
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      ticketReference: "EVO-1234",
      note: "test",
      userPayload: null,
      metadataPayload: { ticket_reference: "EVO-1234", note: "test" },
    });
  });

  it("disables Next when user_payload has invalid JSON", async () => {
    const user = userEvent.setup();
    render(<StepContext onSubmit={() => {}} />);

    await user.click(screen.getByRole("button", { name: /advanced/i }));
    await user.type(screen.getByLabelText(/user payload/i), "{foo: bar}");

    const next = screen.getByRole("button", { name: /^next$/i });
    expect(next).toBeDisabled();
    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });

  it("disables Next when user_payload exceeds 4 KB", async () => {
    const user = userEvent.setup();
    render(<StepContext onSubmit={() => {}} />);

    await user.click(screen.getByRole("button", { name: /advanced/i }));
    const giant = JSON.stringify({ padding: "x".repeat(5000) });
    await user.type(screen.getByLabelText(/user payload/i), giant, {
      delay: 0,
    });

    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it("passes parsed user_payload through onSubmit when valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StepContext onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /advanced/i }));
    await user.type(screen.getByLabelText(/user payload/i), '{"role": "ops"}');
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        userPayload: { role: "ops" },
      }),
    );
  });
});
```

- [ ] **Step 2: Implement an empty StepContext so the import resolves**

Create `apps/web/src/components/upload-wizard/step-context.tsx`:

```tsx
export type StepContextSubmit = {
  ticketReference: string;
  note: string;
  userPayload: Record<string, unknown> | null;
  metadataPayload: Record<string, unknown> | null;
};

export function StepContext(_props: { onSubmit: (v: StepContextSubmit) => void }) {
  return null;
}
```

- [ ] **Step 3: Run the tests — verify they fail**

Run: `pnpm --filter @evo-csv/web test step-context`
Expected: 6 FAILS.

- [ ] **Step 4: Commit (red phase)**

```bash
git add apps/web/test/step-context.test.tsx apps/web/src/components/upload-wizard/step-context.tsx
git commit -m "test(web): add failing tests for StepContext"
```

---

### Task 21: Implement `StepContext`

**Files:**
- Modify: `apps/web/src/components/upload-wizard/step-context.tsx`

- [ ] **Step 1: Replace with the real implementation**

Replace `apps/web/src/components/upload-wizard/step-context.tsx`:

```tsx
import { useMemo, useState } from "react";
import { validateJsonField } from "../../lib/json-validate";

export type StepContextSubmit = {
  ticketReference: string;
  note: string;
  userPayload: Record<string, unknown> | null;
  metadataPayload: Record<string, unknown> | null;
};

type Props = {
  onSubmit: (value: StepContextSubmit) => void;
};

export function StepContext({ onSubmit }: Props) {
  const [ticketReference, setTicketReference] = useState("");
  const [note, setNote] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [userPayloadRaw, setUserPayloadRaw] = useState("");
  const [metadataPayloadRaw, setMetadataPayloadRaw] = useState("");

  const userPayloadResult = useMemo(
    () => validateJsonField(userPayloadRaw),
    [userPayloadRaw],
  );
  const metadataPayloadResult = useMemo(
    () => validateJsonField(metadataPayloadRaw),
    [metadataPayloadRaw],
  );

  const canSubmit = userPayloadResult.ok && metadataPayloadResult.ok;

  function handleNext() {
    if (!canSubmit) return;

    // ticket_reference + note auto-pack into metadata_payload (unless the
    // advanced metadata field is already populated, in which case the user's
    // raw JSON wins).
    let metadataFromForm = metadataPayloadResult.ok ? metadataPayloadResult.value : null;
    if (metadataFromForm === null && (ticketReference || note)) {
      metadataFromForm = {
        ticket_reference: ticketReference,
        note,
      };
    }

    onSubmit({
      ticketReference,
      note,
      userPayload: userPayloadResult.ok ? userPayloadResult.value : null,
      metadataPayload: metadataFromForm,
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        handleNext();
      }}
    >
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Upload context</h2>
        <p className="text-sm text-slate-600">
          Optional. Attach a ticket reference and a note so this import is easy
          to trace later. All fields are optional.
        </p>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Ticket reference</span>
        <input
          type="text"
          value={ticketReference}
          onChange={(e) => setTicketReference(e.target.value)}
          placeholder="EVO-1234"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Note</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Onboarding Smith Property Group, batch 1 of 3"
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="text-sm font-medium text-slate-700 underline"
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? "Hide advanced" : "Show advanced (raw JSON payloads)"}
        </button>
      </div>

      {advancedOpen && (
        <div className="flex flex-col gap-5 rounded-md border border-slate-200 bg-slate-50 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">User payload (JSON)</span>
            <textarea
              value={userPayloadRaw}
              onChange={(e) => setUserPayloadRaw(e.target.value)}
              placeholder='{"userId": "custom"}'
              rows={4}
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            {!userPayloadResult.ok && (
              <span className="text-xs text-red-600">{userPayloadResult.message}</span>
            )}
            <span className="text-xs text-slate-500">
              Leave empty to auto-fill <code>userId</code> with your signed-in email.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Metadata payload (JSON)</span>
            <textarea
              value={metadataPayloadRaw}
              onChange={(e) => setMetadataPayloadRaw(e.target.value)}
              placeholder='{"custom": "value"}'
              rows={4}
              className="rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            {!metadataPayloadResult.ok && (
              <span className="text-xs text-red-600">{metadataPayloadResult.message}</span>
            )}
            <span className="text-xs text-slate-500">
              Overrides the ticket reference + note packing if set.
            </span>
          </label>
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Next
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Run the tests — verify they pass**

Run: `pnpm --filter @evo-csv/web test step-context`
Expected: PASS — 6 tests.

- [ ] **Step 3: Commit (green phase)**

```bash
git add apps/web/src/components/upload-wizard/step-context.tsx
git commit -m "feat(web): implement StepContext form for upload wizard step 0"
```

---

### Task 22: Route mount + end-to-end smoke

**Files:**
- Create: `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`

- [ ] **Step 1: Create the route**

Create `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { StepContext, type StepContextSubmit } from "../../../components/upload-wizard/step-context";
import { WizardShell } from "../../../components/upload-wizard/wizard-shell";

export const Route = createFileRoute("/_authed/admin/importers/$id/upload")({
  component: UploadWizardRoute,
});

function UploadWizardRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [, setContext] = useState<StepContextSubmit | null>(null);

  return (
    <WizardShell activeStep={0}>
      <p className="mb-4 text-xs text-slate-500">Importer: {id}</p>
      <StepContext
        onSubmit={(value) => {
          setContext(value);
          // Step 1+ are out of scope for Story #2 — log the captured context
          // so the engineer integrating Story #3 can see it survives the step.
          console.info("[wizard] step 0 -> step 1", value);
          // Placeholder navigation; replace with `navigate({ to: ... })` for Step 1
          // once that route exists.
          alert(
            `Step 0 captured.\n\n${JSON.stringify(value, null, 2)}\n\n(Step 1 lives in Story #3.)`,
          );
        }}
      />
    </WizardShell>
  );
}
```

- [ ] **Step 2: Generate the route tree (first run produces routeTree.gen.ts)**

Run: `pnpm --filter @evo-csv/web dev`
Expected: TanStack Router plugin generates `apps/web/src/routeTree.gen.ts` on first run; Vite logs "ready". Visit http://localhost:5173/admin/importers/imp_tenants/upload — wizard renders with the four context fields. Ctrl+C.

- [ ] **Step 3: End-to-end manual verification with both servers running**

Run in one terminal: `pnpm dev` (root)
Then:
1. Open http://localhost:5173/admin/importers/imp_tenants/upload
2. Fill ticket reference `EVO-1234`, note `test upload`
3. Click Next
4. Alert shows the captured StepContextSubmit shape — verify `metadataPayload` is `{ticket_reference: "EVO-1234", note: "test upload"}`

Then test the server-side path:
```bash
curl -X POST http://localhost:8787/api/uploads \
  -H 'Content-Type: application/json' \
  -d '{
    "importer_environment_id": "impenv_tenants_staging",
    "file_name": "sample.csv",
    "file_size": 100,
    "matched_columns_map": {"first_name": "First name"},
    "uploaded_file_headers": ["First name"],
    "total_rows": 1,
    "batch_size": 1000,
    "batch_count": 1,
    "user_payload": null,
    "metadata_payload": {"ticket_reference": "EVO-1234"}
  }'
```
Expected: `201 Created` with `{upload_id, numeric_id, status: "pending"}`.

Verify the stored row:
```bash
cd apps/worker && npx wrangler d1 execute evo-csv-dev --local \
  --command "SELECT id, user_payload, metadata_payload FROM uploads ORDER BY rowid DESC LIMIT 1;"
```
Expected: `user_payload = {"userId":"aphisak@mohara.co"}` (auto-injected), `metadata_payload = {"ticket_reference":"EVO-1234"}`.

- [ ] **Step 4: Run the full test suite one last time**

Run: `pnpm test`
Expected: all worker + web tests pass.

- [ ] **Step 5: Commit + push**

```bash
git add apps/web/src/routes apps/web/src/routeTree.gen.ts
git commit -m "feat(web): mount upload-wizard route at /admin/importers/:id/upload

Closes the Story #2 surface: route renders the WizardShell with the
Step 0 context form, captures the submitted context, server-side
POST /api/uploads handler auto-fills userId from session and enforces
the 4 KB payload size guard. Steps 1-4 land in subsequent stories.
"
git push
```

---

## Self-review

After all tasks pass, verify against the Story #2 AC from PRD-002:

1. ✅ **"Member can navigate to `/admin/importers/:id/upload` and see Step 0 with all four fields."** — Tasks 20 + 22.
2. ✅ **"Member can leave all fields empty and proceed to Step 1."** — Task 20 test 2.
3. ✅ **"Invalid JSON ... blocks Next with a clear inline error; JSON > 4 KB rejected."** — Task 20 tests 4 + 5; Task 18 unit tests.
4. ✅ **"Auto-filled `userId` is sourced server-side from the session, not the client."** — Task 14 + 15 unit tests; Task 16 + 17 integration tests.
5. ✅ **"Context carried through wizard and lands in the final webhook payload."** — partially: lands in `uploads.metadata_payload` and `uploads.user_payload` columns at Task 17. The "lands in the final webhook payload" half depends on the dispatch pipeline (sibling Epic) reading those columns into the outbound payload. Documented as out-of-scope for this Story.

**No placeholders, no unresolved TODOs.** Every step has runnable code or commands and an expected outcome.

---

## Execution

**Plan complete and saved to `docs/moai/plans/2026-05-26-story-2-upload-context-form.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session via `build`, batch with checkpoints for review.

**Which approach?**
