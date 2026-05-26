# Story #4 — Match Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Step 2 of the upload wizard — fuzzy auto-suggest a column mapping between the uploaded file's headers and the importer's column schema, let the dev team member adjust any wrong suggestions via per-column dropdowns, and gate the wizard from advancing until every required importer column is matched.

**Architecture:** Backend adds a migration to seed the Tenants importer with 3 columns and a new `GET /api/importers/:id/columns` endpoint scoped by the session's project. Frontend adds a `fuzzy-match.ts` helper using the already-installed `match-sorter` library, then a `StepMatchColumns` component that wraps the file preview from Step 1 with header-row dropdowns. State management stays in the route's existing `WizardState` — Step 2 reads `parsed.headers` + `parsed.rows` from the previous step's output and writes a `matchedColumnsMap` (shape: `{ machine_name: file_header }`, **byte-for-byte the direction usecsv uses**, locked by the captured fixture and Story #3's PRD invariant).

**Tech Stack:** Already in place: pnpm workspace · Hono on Workers · Vite 8 · React 19 · TanStack Router · Vitest · Tailwind v4. New use this story: `match-sorter` (declared in PRD-001's library choices, install in T3) · D1 migration v2 for column seed.

**Maps to GitHub Issue:** [#4 — Member maps columns to the importer schema](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/4)

**Parent Epic:** [#1 — Upload Wizard](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/1)

**Spec references:**
- [`prds/prd-feature-upload-wizard.md`](../../../prds/prd-feature-upload-wizard.md) — Story 3 in §5.3
- [`captured-payloads/2026-05-26-usecsv-live-webhook.json`](../../../captured-payloads/2026-05-26-usecsv-live-webhook.json) — locks the `matchedColumnsMap` direction (`{ "first_name": "First name", ... }`)
- [`docs/superpowers/specs/2026-05-26-usecsv-clone-design.md`](../../superpowers/specs/2026-05-26-usecsv-clone-design.md) — webhook contract §3

---

## File Structure

```
evo-usecsv/
├── apps/
│   ├── worker/
│   │   ├── migrations/
│   │   │   └── 0002_seed_tenants_columns.sql           [N] adds 3 importer_columns
│   │   ├── src/
│   │   │   └── routes/
│   │   │       └── importers.ts                        [N] GET /api/importers/:id/columns
│   │   ├── src/index.ts                                [M] mount importers route
│   │   └── test/
│   │       └── importers.test.ts                       [N] 4 endpoint tests
│   └── web/
│       ├── package.json                                [M] add match-sorter
│       ├── src/
│       │   ├── lib/
│       │   │   └── fuzzy-match.ts                      [N] column-suggestion logic
│       │   ├── components/upload-wizard/
│       │   │   └── step-match-columns.tsx              [N] Step 2 component
│       │   └── routes/_authed/admin/
│       │       └── importers.$id.upload.tsx            [M] fetch columns + Step 1 → Step 2 transition
│       └── test/
│           ├── fuzzy-match.test.ts                     [N] 6 unit tests
│           └── step-match-columns.test.tsx             [N] 6 component tests
```

**Design notes:**
- `fuzzy-match.ts` is a pure function; no UI concerns. Easy to unit-test against fixtures.
- `StepMatchColumns` is a controlled component — accepts `fileHeaders`, `rows` (for the preview), `importerColumns`, and emits `onMatched(matchedColumnsMap)` + `onBack()`. Route owns the data fetch and step state.
- Importer-columns lookup is done in the route via `useEffect` + the Hono RPC client. No TanStack Query dependency this story — keep it simple; the call is one-shot per step.

---

## Shared types

Defined in `apps/web/src/lib/fuzzy-match.ts`, referenced throughout:

```ts
export type ImporterColumn = {
  id: string;
  name: string;            // machine name — becomes the key in matchedColumnsMap
  display_name: string;    // shown to humans
  description: string | null;
  example: string | null;
  must_be_matched: boolean;
  value_cannot_be_blank: boolean;
  validation_type: "string" | "number" | "date" | "phone" | "email" | "regex" | "select" | "boolean";
  validation_format: string | null;
};

export type ColumnMapping = {
  [fileHeader: string]: string | "__ignore__";
  //                    ↑ importer_columns.name when matched
};
```

The component's output (passed to `onMatched`) is the INVERTED form for the webhook payload:

```ts
export type MatchedColumnsMap = Record<string, string>;
// { [machine_name]: file_header } — direction locked by the captured fixture
```

---

# Phase 1 — Backend (Tasks 1–2)

### Task 1: Seed Tenants importer columns

**Files:**
- Create: `apps/worker/migrations/0002_seed_tenants_columns.sql`

Three required columns for the Tenants importer: `first_name`, `last_name`, `email`. This is the minimum that lets the test CSV (`sample-tenants.csv`) produce a happy-path match. Other Laravel-side columns (`mobile_number`, `property_id`, etc.) are out of scope for this story; tracked as a follow-up before real Tenants imports run.

- [ ] **Step 1: Write the migration**

Create `apps/worker/migrations/0002_seed_tenants_columns.sql`:

```sql
-- Story #4: seed the minimum column schema for the Tenants importer.
-- Three required columns drawn from the Laravel TenantsImport row keys
-- (first_name, last_name, email). The remaining Laravel-side columns
-- (mobile_number, home_number, property_id, organisation,
-- property_start_date, property_end_date, customer_resident_reference)
-- are tracked as a follow-up before real production Tenants imports.
INSERT INTO importer_columns (
  id, importer_id, position, name, display_name, description, example,
  must_be_matched, value_cannot_be_blank, validation_type, validation_format,
  custom_error_message
) VALUES
  (
    'col_tenants_first_name',
    'imp_tenants',
    1,
    'first_name',
    'First name',
    NULL,
    'Alice',
    1, 1,
    'string', NULL, NULL
  ),
  (
    'col_tenants_last_name',
    'imp_tenants',
    2,
    'last_name',
    'Last name',
    NULL,
    'Smith',
    1, 1,
    'string', NULL, NULL
  ),
  (
    'col_tenants_email',
    'imp_tenants',
    3,
    'email',
    'Customer Email',
    NULL,
    'alice@example.com',
    1, 1,
    'email', NULL, NULL
  );
```

Note: `0001_initial.sql` already creates the `importer_columns` table and the `imp_tenants` row — this migration only inserts the column data.

- [ ] **Step 2: Apply locally + verify**

Run: `cd apps/worker && npx wrangler d1 migrations apply evo-csv-dev --local`
Expected: "Migration 0002_seed_tenants_columns.sql applied".

Run verification: `cd apps/worker && npx wrangler d1 execute evo-csv-dev --local --command "SELECT name, display_name, must_be_matched, validation_type FROM importer_columns WHERE importer_id = 'imp_tenants' ORDER BY position;"`
Expected: 3 rows with name in (first_name, last_name, email).

- [ ] **Step 3: Run worker tests — make sure migration didn't break anything**

Run: `pnpm --filter @evo-csv/worker test`
Expected: 16 tests pass (the existing suite is unaffected; new columns just appear in the in-memory D1 of every test).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/migrations/0002_seed_tenants_columns.sql
git commit -m "feat(worker): seed Tenants importer with 3 required columns

Adds first_name, last_name, and email as required importer_columns
for the seeded imp_tenants importer. These are the minimum to make
Step 2 (column matching) testable end-to-end with the canonical
sample-tenants.csv fixture. The remaining Laravel-side columns
(mobile_number, property_id, etc.) are a follow-up before real
imports run."
```

---

### Task 2: GET /api/importers/:id/columns endpoint (TDD red→green)

**Files:**
- Create: `apps/worker/src/routes/importers.ts`
- Create: `apps/worker/test/importers.test.ts`
- Modify: `apps/worker/src/index.ts` (mount the new route)

- [ ] **Step 1: Write the failing tests**

Create `apps/worker/test/importers.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/importers/:importer_id/columns", () => {
  it("returns the column list for a known importer scoped to the dev session's project", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_tenants/columns");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      importer_id: "imp_tenants",
      columns: expect.any(Array),
    });
    expect(body.columns).toHaveLength(3);
    expect(body.columns[0]).toMatchObject({
      name: "first_name",
      display_name: "First name",
      must_be_matched: true,
      validation_type: "string",
    });
    expect(body.columns[1]).toMatchObject({ name: "last_name" });
    expect(body.columns[2]).toMatchObject({
      name: "email",
      validation_type: "email",
    });
  });

  it("returns columns in position order, not insertion order", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_tenants/columns");
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.columns.map((c: { name: string }) => c.name);
    expect(names).toEqual(["first_name", "last_name", "email"]);
  });

  it("returns 404 for an unknown importer id", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_nonexistent/columns");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an importer that exists but belongs to a different project (IDOR guard)", async () => {
    // Seed a second project + importer that the dev user is NOT a member of,
    // then verify the dev session cannot read its columns.
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO projects (id, slug, name, created_at) VALUES ('proj_other', 'other', 'Other Co', unixepoch())",
      ),
      env.DB.prepare(
        "INSERT INTO importers (id, project_id, name, created_at, updated_at) VALUES ('imp_other', 'proj_other', 'Other', unixepoch(), unixepoch())",
      ),
      env.DB.prepare(
        `INSERT INTO importer_columns (id, importer_id, position, name, display_name, description, example, must_be_matched, value_cannot_be_blank, validation_type, validation_format, custom_error_message)
         VALUES ('col_other_x', 'imp_other', 1, 'x', 'X', NULL, NULL, 1, 1, 'string', NULL, NULL)`,
      ),
    ]);

    const res = await SELF.fetch("https://example.com/api/importers/imp_other/columns");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Stub the route module**

Create `apps/worker/src/routes/importers.ts`:

```ts
import { Hono } from "hono";
import type { Env, Variables } from "../env.js";

export const importersRoutes = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/:importer_id/columns",
  async (c) => {
    return c.json({ error: "not implemented" }, 501);
  },
);
```

Modify `apps/worker/src/index.ts`. Replace its contents with:

```ts
import { Hono } from "hono";
import type { Env, Variables } from "./env.js";
import { devSession } from "./middleware/dev-session.js";
import { importersRoutes } from "./routes/importers.js";
import { uploadsRoutes } from "./routes/uploads.js";

const app = new Hono<{ Bindings: Env; Variables: Variables }>()
  .get("/api/health", (c) => c.json({ ok: true }))
  .use("/api/*", devSession)
  .get("/api/whoami", (c) => c.json(c.get("session")))
  .route("/api/importers", importersRoutes)
  .route("/api/uploads", uploadsRoutes);

export type AppType = typeof app;
export default app;
```

- [ ] **Step 3: Run + verify FAIL**

Run: `pnpm --filter @evo-csv/worker test importers`
Expected: 4 FAILS — most assert 200 or 404 but get 501 from the stub.

- [ ] **Step 4: Commit (RED)**

```bash
git add apps/worker/src/routes/importers.ts apps/worker/src/index.ts apps/worker/test/importers.test.ts
git commit -m "test(worker): add failing tests for GET /api/importers/:id/columns"
```

- [ ] **Step 5: Implement the endpoint**

Replace `apps/worker/src/routes/importers.ts`:

```ts
import { Hono } from "hono";
import type { Env, Variables } from "../env.js";

type ImporterColumnRow = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: number;
  value_cannot_be_blank: number;
  validation_type: string;
  validation_format: string | null;
};

export const importersRoutes = new Hono<{ Bindings: Env; Variables: Variables }>().get(
  "/:importer_id/columns",
  async (c) => {
    const importerId = c.req.param("importer_id");
    const session = c.get("session");

    try {
      // Project-scoped existence check.
      const importer = await c.env.DB.prepare(
        "SELECT id FROM importers WHERE id = ? AND project_id = ?",
      )
        .bind(importerId, session.project_id)
        .first<{ id: string }>();

      if (!importer) {
        return c.json({ error: "Importer not found" }, 404);
      }

      const result = await c.env.DB.prepare(
        `SELECT id, name, display_name, description, example,
                must_be_matched, value_cannot_be_blank,
                validation_type, validation_format
         FROM importer_columns
         WHERE importer_id = ?
         ORDER BY position ASC`,
      )
        .bind(importerId)
        .all<ImporterColumnRow>();

      const columns = result.results.map((row) => ({
        id: row.id,
        name: row.name,
        display_name: row.display_name,
        description: row.description,
        example: row.example,
        must_be_matched: Boolean(row.must_be_matched),
        value_cannot_be_blank: Boolean(row.value_cannot_be_blank),
        validation_type: row.validation_type,
        validation_format: row.validation_format,
      }));

      return c.json({
        importer_id: importerId,
        columns,
      });
    } catch (err) {
      console.error("DB error in GET /api/importers/:id/columns:", err);
      return c.json({ error: "Database error fetching importer columns" }, 500);
    }
  },
);
```

The key invariants:
- Project-scoping happens at the existence-check stage; an importer that exists in another project returns 404 (not 403 — that would leak existence).
- D1 stores booleans as integers; we coerce them to JS booleans at the API boundary.
- Columns come back in `position ASC` order so the SPA shows them consistently.

- [ ] **Step 6: Run + verify PASS**

Run: `pnpm --filter @evo-csv/worker test`
Expected: 20 tests pass (16 prior + 4 new).

- [ ] **Step 7: Run pnpm format**

- [ ] **Step 8: Commit (GREEN)**

```bash
git add apps/worker/src/routes/importers.ts
git commit -m "feat(worker): implement GET /api/importers/:id/columns

Project-scoped column lookup. Returns rows ordered by position with
booleans coerced to JS booleans at the API boundary. Unknown or
cross-project importer ids return 404 to avoid leaking existence."
```

---

# Phase 2 — Frontend (Tasks 3–5)

### Task 3: fuzzy-match.ts helper (TDD red→green)

**Files:**
- Modify: `apps/web/package.json` (add `match-sorter`)
- Create: `apps/web/src/lib/fuzzy-match.ts`
- Create: `apps/web/test/fuzzy-match.test.ts`

- [ ] **Step 1: Install match-sorter**

Edit `apps/web/package.json` — add to `dependencies` (alphabetical placement):

```json
    "match-sorter": "^6.3.4",
```

Run: `pnpm install`
Expected: `match-sorter` installed. Note the resolved version (might be 6.4+).

- [ ] **Step 2: Write the failing tests**

Create `apps/web/test/fuzzy-match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  suggestColumnMappings,
  type ImporterColumn,
} from "../src/lib/fuzzy-match";

const TENANT_COLUMNS: ImporterColumn[] = [
  {
    id: "col_tenants_first_name",
    name: "first_name",
    display_name: "First name",
    description: null,
    example: "Alice",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_tenants_last_name",
    name: "last_name",
    display_name: "Last name",
    description: null,
    example: "Smith",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_tenants_email",
    name: "email",
    display_name: "Customer Email",
    description: null,
    example: "alice@example.com",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "email",
    validation_format: null,
  },
];

describe("suggestColumnMappings", () => {
  it("maps file headers that exactly match a display_name (case-insensitive)", () => {
    const result = suggestColumnMappings(
      ["First name", "Last name", "Customer Email"],
      TENANT_COLUMNS,
    );
    expect(result["First name"]).toBe("first_name");
    expect(result["Last name"]).toBe("last_name");
    expect(result["Customer Email"]).toBe("email");
  });

  it("maps when the file headers exactly match a machine name", () => {
    const result = suggestColumnMappings(
      ["first_name", "last_name", "email"],
      TENANT_COLUMNS,
    );
    expect(result["first_name"]).toBe("first_name");
    expect(result["email"]).toBe("email");
  });

  it("fuzzy-matches similar headers (whitespace + case differences)", () => {
    const result = suggestColumnMappings(
      ["FIRST NAME", "  Last  Name  ", "customer email"],
      TENANT_COLUMNS,
    );
    expect(result["FIRST NAME"]).toBe("first_name");
    expect(result["  Last  Name  "]).toBe("last_name");
    expect(result["customer email"]).toBe("email");
  });

  it("returns __ignore__ for headers with no plausible match", () => {
    const result = suggestColumnMappings(
      ["First name", "Phone", "Notes"],
      TENANT_COLUMNS,
    );
    expect(result["First name"]).toBe("first_name");
    expect(result["Phone"]).toBe("__ignore__");
    expect(result["Notes"]).toBe("__ignore__");
  });

  it("does NOT assign the same importer column to two different file headers", () => {
    // If two file headers both fuzzy-match to "first_name", only one
    // claim wins — the other becomes __ignore__.
    const result = suggestColumnMappings(
      ["First name", "firstname"], // both want first_name
      TENANT_COLUMNS,
    );
    const claims = Object.values(result).filter((v) => v === "first_name");
    expect(claims).toHaveLength(1);
    // The other should be __ignore__
    expect(Object.values(result).filter((v) => v === "__ignore__")).toHaveLength(1);
  });

  it("returns __ignore__ for every header when importerColumns is empty", () => {
    const result = suggestColumnMappings(["A", "B"], []);
    expect(result).toEqual({ A: "__ignore__", B: "__ignore__" });
  });
});
```

- [ ] **Step 3: Stub the module**

Create `apps/web/src/lib/fuzzy-match.ts`:

```ts
export type ImporterColumn = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: boolean;
  value_cannot_be_blank: boolean;
  validation_type: "string" | "number" | "date" | "phone" | "email" | "regex" | "select" | "boolean";
  validation_format: string | null;
};

export type ColumnMapping = Record<string, string>;
// { [fileHeader]: importerColumns.name | "__ignore__" }

export const IGNORE = "__ignore__" as const;

export function suggestColumnMappings(
  _fileHeaders: string[],
  _importerColumns: ImporterColumn[],
): ColumnMapping {
  throw new Error("not implemented");
}
```

- [ ] **Step 4: Run + verify FAIL**

Run: `pnpm --filter @evo-csv/web test fuzzy-match`
Expected: 6 FAILS with "not implemented".

- [ ] **Step 5: Commit (RED)**

```bash
git add apps/web/src/lib/fuzzy-match.ts apps/web/test/fuzzy-match.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "test(web): add failing tests for suggestColumnMappings"
```

- [ ] **Step 6: Implement the suggester**

Replace `apps/web/src/lib/fuzzy-match.ts`:

```ts
import { matchSorter } from "match-sorter";

export type ImporterColumn = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: boolean;
  value_cannot_be_blank: boolean;
  validation_type:
    | "string"
    | "number"
    | "date"
    | "phone"
    | "email"
    | "regex"
    | "select"
    | "boolean";
  validation_format: string | null;
};

export type ColumnMapping = Record<string, string>;
// { [fileHeader]: importerColumns.name | "__ignore__" }

export const IGNORE = "__ignore__" as const;

/**
 * Normalises a header string for fuzzy comparison:
 *   - lowercase
 *   - collapse runs of whitespace + underscore + dash into a single space
 *   - strip leading/trailing whitespace
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .trim();
}

/**
 * Suggests an initial column mapping. For each file header, finds the
 * best matching importer column by (1) normalised display_name exact
 * match, (2) normalised machine-name exact match, (3) match-sorter
 * fuzzy match against either field. Each importer column can be
 * claimed by at most one file header — when multiple compete, the
 * first (highest-ranked) file header wins; subsequent claimants get
 * IGNORE.
 *
 * Returned shape: `{ [fileHeader]: importerColumns.name | "__ignore__" }`.
 * Inverting this to the wire-format `matchedColumnsMap` is the
 * component's responsibility.
 */
export function suggestColumnMappings(
  fileHeaders: string[],
  importerColumns: ImporterColumn[],
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const claimed = new Set<string>(); // importerColumns.name values already taken

  // Build the search corpus once. Each importer column becomes a
  // searchable record with two keys (display_name + machine name)
  // — match-sorter can rank against both via the `keys` option.
  const corpus = importerColumns.map((c) => ({
    column: c,
    keys: [c.display_name, c.name],
  }));

  for (const header of fileHeaders) {
    if (importerColumns.length === 0) {
      mapping[header] = IGNORE;
      continue;
    }

    const headerNorm = normalise(header);

    // Stage 1: exact normalised match against display_name or machine name
    let pick: ImporterColumn | null = null;
    for (const { column } of corpus) {
      if (claimed.has(column.name)) continue;
      if (
        normalise(column.display_name) === headerNorm ||
        normalise(column.name) === headerNorm
      ) {
        pick = column;
        break;
      }
    }

    // Stage 2: fuzzy match if no exact hit
    if (!pick) {
      const candidates = corpus.filter(({ column }) => !claimed.has(column.name));
      const ranked = matchSorter(candidates, header, {
        keys: ["keys.0", "keys.1"],
        threshold: matchSorter.rankings.CONTAINS,
      });
      if (ranked.length > 0 && ranked[0]) {
        pick = ranked[0].column;
      }
    }

    if (pick) {
      mapping[header] = pick.name;
      claimed.add(pick.name);
    } else {
      mapping[header] = IGNORE;
    }
  }

  return mapping;
}
```

- [ ] **Step 7: Run + verify PASS**

Run: `pnpm --filter @evo-csv/web test fuzzy-match`
Expected: 6 PASS.

Full suite check:
Run: `pnpm --filter @evo-csv/web test`
Expected: 40 tests pass (34 prior + 6 new).

- [ ] **Step 8: Run pnpm format**

- [ ] **Step 9: Commit (GREEN)**

```bash
git add apps/web/src/lib/fuzzy-match.ts
git commit -m "feat(web): implement suggestColumnMappings with match-sorter"
```

---

### Task 4: StepMatchColumns component (TDD red→green)

**Files:**
- Create: `apps/web/src/components/upload-wizard/step-match-columns.tsx`
- Create: `apps/web/test/step-match-columns.test.tsx`

The component:
- Receives `fileHeaders`, `rows` (first 100 used for preview), `importerColumns`, `onMatched`, `onBack`
- On mount, runs `suggestColumnMappings(fileHeaders, importerColumns)` → initial `mapping` state
- Renders a preview table with header dropdowns; each dropdown lists every importer column (by `display_name`) + "Ignore this column"
- Changing a dropdown updates `mapping` AND auto-unsets any other file header that was mapped to the newly-selected importer column (each importer column claimed by ≤1 file header)
- Banner shows status: `"All required columns matched"` (green) OR `"Missing required: <list of display names>"` (red)
- "Next" disabled while any required importer column is unmatched
- On Next: invert the mapping into `{ machine_name: file_header }` (the wire format) and call `onMatched(map)`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/step-match-columns.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepMatchColumns } from "../src/components/upload-wizard/step-match-columns";
import type { ImporterColumn } from "../src/lib/fuzzy-match";

const TENANT_COLUMNS: ImporterColumn[] = [
  {
    id: "col_first_name",
    name: "first_name",
    display_name: "First name",
    description: null,
    example: "Alice",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_last_name",
    name: "last_name",
    display_name: "Last name",
    description: null,
    example: "Smith",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_email",
    name: "email",
    display_name: "Customer Email",
    description: null,
    example: "alice@example.com",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "email",
    validation_format: null,
  },
];

const FILE_HEADERS = ["First name", "Last name", "Customer Email", "Notes"];
const ROWS = [
  {
    "First name": "Alice",
    "Last name": "Smith",
    "Customer Email": "alice@example.com",
    Notes: "VIP",
  },
  {
    "First name": "Bob",
    "Last name": "Jones",
    "Customer Email": "bob@example.com",
    Notes: "",
  },
];

function renderStep(overrides: Partial<Parameters<typeof StepMatchColumns>[0]> = {}) {
  return render(
    <StepMatchColumns
      fileHeaders={FILE_HEADERS}
      rows={ROWS}
      importerColumns={TENANT_COLUMNS}
      onMatched={() => {}}
      onBack={() => {}}
      {...overrides}
    />,
  );
}

describe("StepMatchColumns", () => {
  it("auto-suggests matches and shows 'All required columns matched'", () => {
    renderStep();
    expect(screen.getByText(/all required columns matched/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled();
  });

  it("shows missing required when one of the required columns is unmatched", () => {
    renderStep({ fileHeaders: ["First name", "Last name", "Notes"] });
    // No header that matches "Customer Email" — required column is missing
    expect(screen.getByText(/missing required.*customer email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it("calls onMatched with the inverted map { machine_name: file_header } when Next is clicked", () => {
    const onMatched = vi.fn();
    renderStep({ onMatched });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(onMatched).toHaveBeenCalledTimes(1);
    expect(onMatched).toHaveBeenCalledWith({
      first_name: "First name",
      last_name: "Last name",
      email: "Customer Email",
    });
  });

  it("excludes ignored file headers from the inverted map", () => {
    const onMatched = vi.fn();
    renderStep({ onMatched });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    const arg = onMatched.mock.calls[0]?.[0];
    expect(arg.Notes).toBeUndefined(); // 'Notes' was auto-set to Ignore
  });

  it("unsets the previous file header when a new one claims the same importer column", () => {
    renderStep();
    // The auto-suggestion claims "First name" -> first_name. If the user
    // now maps "Last name" to first_name (unusual but possible), the
    // previous "First name" mapping should auto-unset to Ignore.
    const selects = screen.getAllByRole("combobox");
    const lastNameDropdown = selects.find(
      (el) => el.getAttribute("aria-label") === "Map column Last name",
    );
    expect(lastNameDropdown).toBeDefined();
    fireEvent.change(lastNameDropdown!, { target: { value: "first_name" } });

    // After the change: only ONE file header maps to first_name
    const firstNameDropdown = selects.find(
      (el) => el.getAttribute("aria-label") === "Map column First name",
    );
    expect(firstNameDropdown).toHaveValue("__ignore__");
    expect(lastNameDropdown).toHaveValue("first_name");
  });

  it("calls onBack when Back is clicked", () => {
    const onBack = vi.fn();
    renderStep({ onBack });
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Stub the component**

Create `apps/web/src/components/upload-wizard/step-match-columns.tsx`:

```tsx
import type { ImporterColumn } from "../../lib/fuzzy-match";

export type StepMatchColumnsProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  onMatched: (matchedColumnsMap: Record<string, string>) => void;
  onBack: () => void;
};

export function StepMatchColumns(_props: StepMatchColumnsProps) {
  return null;
}
```

- [ ] **Step 3: Run + verify FAIL**

Run: `pnpm --filter @evo-csv/web test step-match-columns`
Expected: 6 FAILS — stub renders nothing.

- [ ] **Step 4: Commit (RED)**

```bash
git add apps/web/src/components/upload-wizard/step-match-columns.tsx apps/web/test/step-match-columns.test.tsx
git commit -m "test(web): add failing tests for StepMatchColumns"
```

- [ ] **Step 5: Implement the component**

Replace `apps/web/src/components/upload-wizard/step-match-columns.tsx`:

```tsx
import { useMemo, useState } from "react";
import { IGNORE, suggestColumnMappings, type ColumnMapping, type ImporterColumn } from "../../lib/fuzzy-match";

export type StepMatchColumnsProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  onMatched: (matchedColumnsMap: Record<string, string>) => void;
  onBack: () => void;
};

export function StepMatchColumns({
  fileHeaders,
  rows,
  importerColumns,
  onMatched,
  onBack,
}: StepMatchColumnsProps) {
  // Initial suggestion runs once on mount; user can override via dropdowns.
  const initialMapping = useMemo(
    () => suggestColumnMappings(fileHeaders, importerColumns),
    // We deliberately only run this once — fileHeaders and importerColumns
    // are stable for the lifetime of this step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);

  function handleChange(fileHeader: string, newValue: string) {
    setMapping((prev) => {
      const next: ColumnMapping = { ...prev };
      // If newValue is a real importer column name (not IGNORE), unclaim
      // any other file header that previously held it.
      if (newValue !== IGNORE) {
        for (const otherHeader of Object.keys(next)) {
          if (otherHeader !== fileHeader && next[otherHeader] === newValue) {
            next[otherHeader] = IGNORE;
          }
        }
      }
      next[fileHeader] = newValue;
      return next;
    });
  }

  // Status banner derivation
  const requiredColumns = importerColumns.filter((c) => c.must_be_matched);
  const matchedColumnNames = new Set(
    Object.values(mapping).filter((v) => v !== IGNORE),
  );
  const missingRequired = requiredColumns.filter(
    (c) => !matchedColumnNames.has(c.name),
  );
  const allRequiredMatched = missingRequired.length === 0;

  function handleNext() {
    if (!allRequiredMatched) return;
    // Invert: { fileHeader: machine_name } -> { machine_name: fileHeader }
    // Skip IGNORE entries — they don't go in the webhook.
    const inverted: Record<string, string> = {};
    for (const [fileHeader, columnName] of Object.entries(mapping)) {
      if (columnName !== IGNORE) {
        inverted[columnName] = fileHeader;
      }
    }
    onMatched(inverted);
  }

  const previewRows = rows.slice(0, 50);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Match columns</h2>
        <p className="text-sm text-slate-600">
          Confirm or adjust each column mapping. The wizard pre-selected
          the closest match for each file header — required columns must
          be mapped to continue.
        </p>
      </header>

      {allRequiredMatched ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ All required columns matched
        </div>
      ) : (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Missing required: {missingRequired.map((c) => c.display_name).join(", ")}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-100">
            <tr>
              {fileHeaders.map((header) => (
                <th
                  key={header}
                  className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                >
                  <div className="flex flex-col gap-1">
                    <span>{header}</span>
                    <select
                      aria-label={`Map column ${header}`}
                      value={mapping[header] ?? IGNORE}
                      onChange={(e) => handleChange(header, e.target.value)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-normal"
                    >
                      <option value={IGNORE}>Ignore this column</option>
                      {importerColumns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.display_name}
                          {c.must_be_matched ? " *" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => (
              <tr key={idx} className="even:bg-slate-50">
                {fileHeaders.map((header) => (
                  <td
                    key={header}
                    className="border-b border-slate-100 px-3 py-1.5 text-slate-700"
                  >
                    {row[header] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > previewRows.length && (
        <p className="text-xs text-slate-500">
          Showing first {previewRows.length} of {rows.length.toLocaleString("en-US")} rows.
        </p>
      )}

      <footer className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={!allRequiredMatched}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Next
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 6: Run + verify PASS**

Run: `pnpm --filter @evo-csv/web test step-match-columns`
Expected: 6 PASS.

Full suite check:
Run: `pnpm --filter @evo-csv/web test`
Expected: 46 tests pass (40 prior + 6 new).

- [ ] **Step 7: Run pnpm format**

- [ ] **Step 8: Commit (GREEN)**

```bash
git add apps/web/src/components/upload-wizard/step-match-columns.tsx
git commit -m "feat(web): implement StepMatchColumns for wizard step 2"
```

---

### Task 5: Route integration + E2E smoke

**Files:**
- Modify: `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`

The route now:
- Tracks `activeStep: 0 | 1 | 2`
- Fetches importer columns on mount via `useEffect` + the Hono RPC client
- Holds `importerColumns` and `matchedColumns` in `WizardState`
- Step 2 (Match) renders when `activeStep === 2 && parsed && importerColumns`
- Step 1 → Step 2 transition: `handleFileParsed` now sets `activeStep = 2` (no more Story #4 TODO)
- Step 2 → Step 3 placeholder: logs `[wizard] step 2 -> step 3` with the full mapped payload; that becomes Story #5's input

- [ ] **Step 1: Update the route**

Replace `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  StepContext,
  type StepContextSubmit,
} from "../../../components/upload-wizard/step-context";
import { StepMatchColumns } from "../../../components/upload-wizard/step-match-columns";
import { StepUploadFile } from "../../../components/upload-wizard/step-upload-file";
import { WizardShell } from "../../../components/upload-wizard/wizard-shell";
import type { ImporterColumn } from "../../../lib/fuzzy-match";
import type { ParseSuccess } from "../../../lib/parse-file";

export const Route = createFileRoute("/_authed/admin/importers/$id/upload")({
  component: UploadWizardRoute,
});

type WizardState = {
  context: StepContextSubmit | null;
  parsed: ParseSuccess | null;
  matched: Record<string, string> | null;
};

function UploadWizardRoute() {
  const { id } = Route.useParams();
  const [activeStep, setActiveStep] = useState<0 | 1 | 2>(0);
  const [state, setState] = useState<WizardState>({
    context: null,
    parsed: null,
    matched: null,
  });
  const [importerColumns, setImporterColumns] = useState<ImporterColumn[] | null>(null);
  const [columnsError, setColumnsError] = useState<string | null>(null);

  // Fetch importer columns once per importer id.
  useEffect(() => {
    let cancelled = false;
    setColumnsError(null);
    fetch(`/api/importers/${id}/columns`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch columns: ${res.status}`);
        return res.json() as Promise<{ columns: ImporterColumn[] }>;
      })
      .then((data) => {
        if (!cancelled) setImporterColumns(data.columns);
      })
      .catch((err) => {
        if (!cancelled) setColumnsError(err instanceof Error ? err.message : "Unknown error");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function handleContextSubmit(context: StepContextSubmit) {
    setState((s) => ({ ...s, context }));
    setActiveStep(1);
  }

  function handleFileParsed(parsed: ParseSuccess) {
    setState((s) => ({ ...s, parsed }));
    setActiveStep(2);
  }

  function handleMatched(matched: Record<string, string>) {
    setState((s) => {
      // TODO(Story #5): advance to Review & Edit using s.context + s.parsed + matched.
      console.info("[wizard] step 2 -> step 3", {
        context: s.context,
        parsed: s.parsed,
        matched,
      });
      return { ...s, matched };
    });
  }

  return (
    <WizardShell activeStep={activeStep}>
      <p className="mb-4 text-xs text-slate-500">Importer: {id}</p>

      {activeStep === 0 && <StepContext onSubmit={handleContextSubmit} />}

      {activeStep === 1 && (
        <StepUploadFile onParsed={handleFileParsed} onBack={() => setActiveStep(0)} />
      )}

      {activeStep === 2 && state.parsed && (
        <>
          {columnsError && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn't load importer columns: {columnsError}
            </div>
          )}
          {!importerColumns && !columnsError && (
            <p className="text-sm text-slate-500">Loading importer columns…</p>
          )}
          {importerColumns && (
            <StepMatchColumns
              fileHeaders={state.parsed.headers}
              rows={state.parsed.rows}
              importerColumns={importerColumns}
              onMatched={handleMatched}
              onBack={() => setActiveStep(1)}
            />
          )}
        </>
      )}

      {state.matched && (
        <p className="mt-4 text-xs text-slate-500">
          Step 2 captured ({Object.keys(state.matched).length} columns mapped).
          Step 3 lands in Story #5.
        </p>
      )}
    </WizardShell>
  );
}
```

- [ ] **Step 2: Regenerate route tree if needed + build check**

Run: `pnpm --filter @evo-csv/web build`
Expected: passes. The route file's contents changed but not its path; route tree regeneration not required.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: 20 worker + 46 web = **66 tests** pass.

- [ ] **Step 4: Manual browser smoke (script-driven prep, manual UI walk)**

Start both servers:
```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 8
```

Sanity check both reachable:
```bash
curl -s -o /dev/null -w "worker: %{http_code}\n" http://localhost:8787/api/health
curl -s -o /dev/null -w "web: %{http_code}\n" http://localhost:5173/
```
Expected: `worker: 200` / `web: 200`.

Verify the new endpoint serves data:
```bash
curl -s http://localhost:8787/api/importers/imp_tenants/columns | jq '.columns | length'
```
Expected: `3`.

Verify the cross-project IDOR guard still works at runtime:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8787/api/importers/imp_nonexistent/columns
```
Expected: `404`.

For the browser walkthrough (cannot be automated from a subagent):
1. `http://localhost:5173/admin/importers/imp_tenants/upload`
2. Step 0 — leave fields empty → Next
3. Step 1 — drop `sample-tenants.csv` → Next
4. Step 2 renders: header dropdowns show "First name"→first_name, "Last name"→last_name, "Customer Email"→email, "Notes"→Ignore. Banner says "✓ All required columns matched". Next is enabled.
5. Change "First name" dropdown to "Ignore this column" — banner switches to "Missing required: First name" and Next becomes disabled.
6. Change it back to "First name" — banner returns to green and Next re-enables.
7. Click Next → DevTools console: `[wizard] step 2 -> step 3 { context, parsed, matched: { first_name: "First name", last_name: "Last name", email: "Customer Email" } }`. Note the `matched` direction matches the captured fixture.
8. "Step 2 captured (3 columns mapped). Step 3 lands in Story #5." appears.
9. Click Back from Step 2 — returns to Step 1 with the previously-uploaded file still selected. (Actually — Story #3's StepUploadFile keeps its own internal state; check whether re-mounting it resets to the empty drop zone. If it does, that's a Story #3 wart, not Story #4's concern.)

Cleanup:
```bash
kill $DEV_PID 2>/dev/null
pkill -f "wrangler.*dev" 2>/dev/null
pkill -f "vite/bin/vite" 2>/dev/null
sleep 1
```

- [ ] **Step 5: Run pnpm format**

- [ ] **Step 6: Commit + push**

```bash
git add apps/web/src/routes/_authed/admin/importers.$id.upload.tsx
git commit -m "feat(web): wire Step 1 -> Step 2 transition + importer columns fetch

Adds a useEffect-based fetch of /api/importers/:id/columns on route
mount. Step 2 renders StepMatchColumns once parsed + importerColumns
are both loaded. Loading and error states are surfaced inline.
Step 2 -> Step 3 logs the inverted matchedColumnsMap to the console;
Story #5 will replace that with the Review & Edit step."
git push -u origin feature/4-match-columns
```

---

## Self-review

Checking against PRD-002 §5.3 (Story 3 — "Member maps columns to the importer schema"):

| AC | Task |
|---|---|
| 1. On entry, every file column has either an auto-suggestion or "Ignore" | Task 4 (`suggestColumnMappings` runs in `useMemo` on mount; component renders the dropdowns with the suggested values) + Task 3 ("auto-suggests matches" test) |
| 2. Each header has a dropdown listing importer columns + "Ignore" + a default | Task 4 (the `<select>` has `Ignore this column` + every `importerColumns.map((c) => <option ...>)`); no separate "—" default because the dropdown always has a concrete value (either the suggestion, the user's pick, or `__ignore__`). |
| 3. Banner status updates in real time on every dropdown change | Task 4 (derived from `mapping` state which is `useState`; React re-renders on change) |
| 4. Required-not-matched blocks Next; hover hint | Task 4 (`Next` is `disabled={!allRequiredMatched}`); native `title` tooltip is NOT added in this pass — `disabled` buttons don't trigger title hovers in all browsers anyway. The banner above the table communicates the requirement instead. |
| 5. File column maps to one importer column max (auto-unset previous) | Task 4 (`handleChange` loop unsets prior holder) + Task 4 test "unsets the previous file header when a new one claims the same importer column" |
| 6. `matchedColumnsMap` shape is `{ machine_name: file_header }` (matches fixture) | Task 4 `handleNext` inverts the internal mapping; Task 4 test "calls onMatched with the inverted map" asserts the exact shape against the canonical fixture data |

**Partial AC noted:**
- AC 4's hover-on-disabled-Next tooltip is not implemented. The banner conveys the same information; the disabled state is communicated visually. Easy follow-up if usability testing shows it's needed.

**Type consistency check:**
- `ImporterColumn` defined in `apps/web/src/lib/fuzzy-match.ts`, re-exported / imported from the route and the component. Same shape used in the test fixtures.
- `MatchedColumnsMap` is not exported as a named type — the inverted output is just `Record<string, string>` in the function signatures. This is intentional (it's the wire-format direction; defining a named type would be overkill for a record-of-strings) and consistent with how Story #2 represents the same shape in the worker.
- `IGNORE = "__ignore__"` is exported as a const from `fuzzy-match.ts` and used by both the component (`mapping[header] ?? IGNORE`) and the dropdown `<option value={IGNORE}>`. No magic-string drift.

**No placeholders found.** Every step contains the actual code or commands.

---

## Execution

**Plan complete and saved to `docs/moai/plans/2026-05-26-story-4-match-columns.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — same pattern that shipped Stories #2 and #3: fresh subagent per task, inline review on the heavy ones (T4 component), final review on the branch.

**2. Inline Execution** — execute with `build`, batched with checkpoints.

**Which approach?**
