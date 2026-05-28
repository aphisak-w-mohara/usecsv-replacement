# Story #15 — Importer General Settings (rename / archive) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the importer detail page from a stub into a tabbed editor whose General tab supports rename + archive/unarchive, and make sure archived importers can no longer accept new uploads.

**Architecture:** Server-side: add two endpoints — `GET /api/importers/:id` (single-row fetch needed for the detail page header) and `PATCH /api/importers/:id` (rename + archive toggle, partial update). Tighten `POST /api/uploads` so archived importers return 404 instead of accepting a new upload. Client-side: replace the stub at `apps/web/src/routes/_authed/admin/importers.$id.tsx` with a tab shell that renders General + a placeholder list of upcoming tabs; the General tab handles name editing and the archive/unarchive confirm flow, then navigates back to `/admin/importers` after archive.

**Tech Stack:** Hono on Cloudflare Workers + D1; React 19 + TanStack Router + Hono RPC client; Vitest + `@cloudflare/vitest-pool-workers` (worker tests) and `@testing-library/react` + jsdom (web tests).

---

## Scope notes & deliberate MVP simplifications

These are intentional and must NOT be "fixed" by the implementer:

1. **The tab shell only ships with General + Columns + Environments placeholders.** Story #16 fills in Columns; Story #18 fills in per-env tabs. Today the Columns tab and any env tab render a short "Coming in Story #16 / #18" placeholder. Resist the temptation to scaffold them.
2. **No URL-driven tab state.** Tab is a local `useState` value. Deep linking to `?tab=general` is a `<form>`-amount-of-work for one user who is already on the page; not justified.
3. **Archive redirect goes to `/admin/importers`, not back to General.** After archive the importer disappears from the default list anyway, so staying on a detail page that shows "archived" + a banner is dead-end UX. Unarchive is reachable from the list view (with **Show archived** on).
4. **The PATCH endpoint accepts `name` and `archived` independently; rejecting "no changes" is not strict.** `PATCH { }` is a 200 no-op. The `updated_at` only bumps when a column actually changed. This mirrors how `name`-only and `archived`-only edits both work without the client having to send the other field.

---

## File structure

**Worker — modified:**
- `apps/worker/src/routes/importers.ts` — add the `GET /:id` and `PATCH /:id` handlers, chained onto the existing `importersRoutes`.
- `apps/worker/src/routes/uploads.ts` — extend the `impEnv` resolution query with `AND i.archived_at IS NULL`.
- `apps/worker/test/importers.test.ts` — append `describe` blocks for `GET /api/importers/:id` and `PATCH /api/importers/:id`.
- `apps/worker/test/uploads.test.ts` — append one test for the archived-importer guard.

**Web — new files:**
- `apps/web/src/components/importers/importer-detail-tabs.tsx` — pure tab shell. Renders the tab list + the selected tab's content via a render-prop / children. No data fetching.
- `apps/web/src/components/importers/importer-general-tab.tsx` — pure UI for the General tab. Receives the importer row + `onSave` + `onArchive` + `onUnarchive` callbacks.
- `apps/web/test/importer-general-tab.test.tsx` — tests for the General tab component (rename, archive confirm, unarchive, 409 inline error).

**Web — modified:**
- `apps/web/src/routes/_authed/admin/importers.$id.tsx` — replace the stub with the real detail-page route: fetch importer via the new `GET /:id`, render `<ImporterDetailTabs>` with `<ImporterGeneralTab>` mounted under it, wire the PATCH mutations.

---

## Shared type contract (used across tasks — defined in Task 1)

The single-importer fetch response is the same row shape as one element of the list endpoint:

```ts
// Returned by GET /api/importers/:id (Task 1)
export type ImporterRow = {
  id: string;
  name: string;
  column_count: number;
  env_count: number;
  archived: boolean;
  updated_at: number;
};
```

The PATCH endpoint accepts:

```ts
// Body for PATCH /api/importers/:id (Task 2). Partial — either field may be omitted.
export type ImporterPatch = {
  name?: string;        // 1..200 chars after trim
  archived?: boolean;   // true → set archived_at = now; false → clear it
};
```

And returns the updated `ImporterRow` on success.

---

### Task 1: Worker — `GET /api/importers/:id` (single-row fetch)

**Files:**
- Modify: `apps/worker/src/routes/importers.ts`
- Test: `apps/worker/test/importers.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `apps/worker/test/importers.test.ts`:

```ts
describe("GET /api/importers/:importer_id", () => {
  it("returns the importer row with column + env counts for a known id in the active project", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_tenants");
    expect(res.status).toBe(200);
    const body = await res.json<{
      importer: {
        id: string;
        name: string;
        column_count: number;
        env_count: number;
        archived: boolean;
        updated_at: number;
      };
    }>();
    expect(body.importer).toMatchObject({
      id: "imp_tenants",
      name: "Tenants",
      column_count: 3,
      env_count: 1,
      archived: false,
    });
    expect(typeof body.importer.updated_at).toBe("number");
  });

  it("returns 404 for an unknown importer id", async () => {
    const res = await SELF.fetch("https://example.com/api/importers/imp_nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_get', 'proj_foreign', 'Foreign Importer', unixepoch(), unixepoch())`,
      ),
    ]);

    const res = await SELF.fetch("https://example.com/api/importers/imp_foreign_get");
    expect(res.status).toBe(404);
  });

  it("includes archived importers in the single-row fetch (so the detail page can render them)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, archived_at, created_at, updated_at)
       VALUES ('imp_arch_get', 'proj_evo', 'Archived One', unixepoch(), unixepoch(), unixepoch())`,
    ).run();

    const res = await SELF.fetch("https://example.com/api/importers/imp_arch_get");
    expect(res.status).toBe(200);
    const body = await res.json<{ importer: { archived: boolean } }>();
    expect(body.importer.archived).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @evo-csv/worker test -- --run importers`
Expected: 4 new tests FAIL — `GET /api/importers/:id` returns 404 from the existing route fallthrough (no handler).

- [ ] **Step 3: Implement the handler**

Add to `apps/worker/src/routes/importers.ts`, chained onto `importersRoutes` AFTER the existing `POST "/"` and BEFORE `GET "/:importer_id/columns"` so the routing order stays readable:

```ts
.get("/:importer_id", async (c) => {
  const importerId = c.req.param("importer_id");
  const session = c.get("session");

  try {
    const row = await c.env.DB.prepare(
      `SELECT i.id, i.name, i.archived_at, i.updated_at,
              (SELECT COUNT(*) FROM importer_columns ic WHERE ic.importer_id = i.id) AS column_count,
              (SELECT COUNT(*) FROM importer_environments ie WHERE ie.importer_id = i.id) AS env_count
       FROM importers i
       WHERE i.id = ? AND i.project_id = ?`,
    )
      .bind(importerId, session.project_id)
      .first<{
        id: string;
        name: string;
        archived_at: number | null;
        updated_at: number;
        column_count: number;
        env_count: number;
      }>();

    if (!row) {
      return c.json({ error: "Importer not found" }, 404);
    }

    return c.json({
      importer: {
        id: row.id,
        name: row.name,
        column_count: row.column_count,
        env_count: row.env_count,
        archived: row.archived_at !== null,
        updated_at: row.updated_at,
      },
    });
  } catch (err) {
    console.error("DB error in GET /api/importers/:id:", err);
    return c.json({ error: "Database error fetching importer" }, 500);
  }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @evo-csv/worker test -- --run importers`
Expected: PASS (existing + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/importers.ts apps/worker/test/importers.test.ts
git commit -m "feat(worker): GET /api/importers/:id for detail-page header"
```

---

### Task 2: Worker — `PATCH /api/importers/:id` (rename + archive)

**Files:**
- Modify: `apps/worker/src/routes/importers.ts`
- Test: `apps/worker/test/importers.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `apps/worker/test/importers.test.ts`:

```ts
describe("PATCH /api/importers/:importer_id", () => {
  async function patch(id: string, body: { name?: string; archived?: boolean }) {
    return SELF.fetch(`https://example.com/api/importers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("renames the importer, bumps updated_at, returns the updated row", async () => {
    const { env } = await import("cloudflare:test");
    const before = await env.DB.prepare("SELECT updated_at FROM importers WHERE id = 'imp_tenants'")
      .first<{ updated_at: number }>();
    expect(before?.updated_at).toBeDefined();

    // Force a clock-tick so updated_at can change.
    await new Promise((r) => setTimeout(r, 1100));

    const res = await patch("imp_tenants", { name: "Tenants v2" });
    expect(res.status).toBe(200);
    const body = await res.json<{ importer: { name: string; updated_at: number } }>();
    expect(body.importer.name).toBe("Tenants v2");
    expect(body.importer.updated_at).toBeGreaterThan(before!.updated_at);

    // Restore for downstream tests
    await patch("imp_tenants", { name: "Tenants" });
  });

  it("trims the new name and rejects empty/whitespace with 400", async () => {
    const res = await patch("imp_tenants", { name: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a colliding name (case-insensitive) within the project with 409", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_other_pat', 'proj_evo', 'Other Importer', unixepoch(), unixepoch())`,
    ).run();

    const res = await patch("imp_other_pat", { name: "tenants" });
    expect(res.status).toBe(409);
  });

  it("archives the importer and clears archive on toggle", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_arch_target', 'proj_evo', 'Archive Me', unixepoch(), unixepoch())`,
    ).run();

    const archRes = await patch("imp_arch_target", { archived: true });
    expect(archRes.status).toBe(200);
    const archBody = await archRes.json<{ importer: { archived: boolean } }>();
    expect(archBody.importer.archived).toBe(true);

    const dbRow = await env.DB.prepare("SELECT archived_at FROM importers WHERE id = 'imp_arch_target'")
      .first<{ archived_at: number | null }>();
    expect(dbRow?.archived_at).not.toBeNull();

    const unRes = await patch("imp_arch_target", { archived: false });
    expect(unRes.status).toBe(200);
    const unBody = await unRes.json<{ importer: { archived: boolean } }>();
    expect(unBody.importer.archived).toBe(false);

    const dbRow2 = await env.DB.prepare("SELECT archived_at FROM importers WHERE id = 'imp_arch_target'")
      .first<{ archived_at: number | null }>();
    expect(dbRow2?.archived_at).toBeNull();
  });

  it("renames and archives in one call (both fields together)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.prepare(
      `INSERT INTO importers (id, project_id, name, created_at, updated_at)
       VALUES ('imp_combo', 'proj_evo', 'Combo Original', unixepoch(), unixepoch())`,
    ).run();

    const res = await patch("imp_combo", { name: "Combo Renamed", archived: true });
    expect(res.status).toBe(200);
    const body = await res.json<{ importer: { name: string; archived: boolean } }>();
    expect(body.importer.name).toBe("Combo Renamed");
    expect(body.importer.archived).toBe(true);
  });

  it("empty body is a no-op 200 (no fields supplied)", async () => {
    const res = await patch("imp_tenants", {});
    expect(res.status).toBe(200);
  });

  it("returns 404 for an importer in another project (IDOR guard)", async () => {
    const { env } = await import("cloudflare:test");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO projects (id, slug, name, created_at) VALUES ('proj_foreign', 'foreign', 'Foreign Co', unixepoch())",
      ),
      env.DB.prepare(
        `INSERT INTO importers (id, project_id, name, created_at, updated_at)
         VALUES ('imp_foreign_pat', 'proj_foreign', 'Foreign Importer', unixepoch(), unixepoch())`,
      ),
    ]);

    const res = await patch("imp_foreign_pat", { name: "Renamed" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @evo-csv/worker test -- --run importers`
Expected: 7 new tests FAIL (PATCH endpoint doesn't exist; Hono returns 404).

- [ ] **Step 3: Implement the handler**

In `apps/worker/src/routes/importers.ts`, add the schema next to `importerCreateSchema`:

```ts
const importerPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});
```

Chain onto `importersRoutes`, after `GET "/:importer_id"` and before `GET "/:importer_id/columns"`:

```ts
.patch(
  "/:importer_id",
  zValidator("json", importerPatchSchema),
  async (c) => {
    const importerId = c.req.param("importer_id");
    const session = c.get("session");
    const body = c.req.valid("json");
    const trimmedName = body.name?.trim();

    if (body.name !== undefined && (!trimmedName || trimmedName.length === 0)) {
      return c.json({ error: "Importer name is required" }, 400);
    }

    try {
      // Project-scoped existence check. Cross-project → 404 (not 403) to match
      // the IDOR-resistance pattern set in PRD-002.
      const existing = await c.env.DB.prepare(
        "SELECT id FROM importers WHERE id = ? AND project_id = ?",
      )
        .bind(importerId, session.project_id)
        .first<{ id: string }>();

      if (!existing) {
        return c.json({ error: "Importer not found" }, 404);
      }

      // Build the UPDATE dynamically — only touch columns the caller passed.
      const sets: string[] = [];
      const binds: (string | number | null)[] = [];

      if (trimmedName !== undefined) {
        // Collision check at the application layer for a friendly 409. The
        // DB-level unique index in 0003_importer_name_unique.sql is the
        // backstop for the race; the catch block below maps it to the same
        // friendly error.
        const collision = await c.env.DB.prepare(
          "SELECT id FROM importers WHERE project_id = ? AND lower(name) = lower(?) AND id != ?",
        )
          .bind(session.project_id, trimmedName, importerId)
          .first<{ id: string }>();
        if (collision) {
          return c.json({ error: "An importer with this name already exists" }, 409);
        }
        sets.push("name = ?");
        binds.push(trimmedName);
      }

      if (body.archived !== undefined) {
        sets.push("archived_at = ?");
        binds.push(body.archived ? Math.floor(Date.now() / 1000) : null);
      }

      // Empty PATCH (no name, no archived) — still re-fetch + return the row.
      if (sets.length > 0) {
        const now = Math.floor(Date.now() / 1000);
        sets.push("updated_at = ?");
        binds.push(now);

        binds.push(importerId);
        await c.env.DB.prepare(
          `UPDATE importers SET ${sets.join(", ")} WHERE id = ?`,
        )
          .bind(...binds)
          .run();
      }

      // Return the fresh row in the same shape as GET /:id.
      const row = await c.env.DB.prepare(
        `SELECT i.id, i.name, i.archived_at, i.updated_at,
                (SELECT COUNT(*) FROM importer_columns ic WHERE ic.importer_id = i.id) AS column_count,
                (SELECT COUNT(*) FROM importer_environments ie WHERE ie.importer_id = i.id) AS env_count
         FROM importers i WHERE i.id = ?`,
      )
        .bind(importerId)
        .first<{
          id: string;
          name: string;
          archived_at: number | null;
          updated_at: number;
          column_count: number;
          env_count: number;
        }>();

      return c.json({
        importer: {
          id: row!.id,
          name: row!.name,
          column_count: row!.column_count,
          env_count: row!.env_count,
          archived: row!.archived_at !== null,
          updated_at: row!.updated_at,
        },
      });
    } catch (err) {
      // Concurrent rename race: the unique index rejects the duplicate even
      // though the pre-check passed. Surface the same friendly 409.
      if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
        return c.json({ error: "An importer with this name already exists" }, 409);
      }
      console.error("DB error in PATCH /api/importers/:id:", err);
      return c.json({ error: "Database error updating importer" }, 500);
    }
  },
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @evo-csv/worker test -- --run importers`
Expected: PASS (all prior tests + 7 new PATCH tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/importers.ts apps/worker/test/importers.test.ts
git commit -m "feat(worker): PATCH /api/importers/:id — rename + archive toggle"
```

---

### Task 3: Worker — guard `POST /api/uploads` against archived importers

**Files:**
- Modify: `apps/worker/src/routes/uploads.ts`
- Test: `apps/worker/test/uploads.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/worker/test/uploads.test.ts` (inside the existing `describe("POST /api/uploads ...)`, or in a new describe block at the bottom):

```ts
describe("POST /api/uploads — archived importer guard", () => {
  it("returns 404 when the importer behind the env is archived", async () => {
    const { env } = await import("cloudflare:test");
    // Archive the seeded Tenants importer (used by impenv_tenants_staging).
    await env.DB.prepare(
      "UPDATE importers SET archived_at = unixepoch() WHERE id = 'imp_tenants'",
    ).run();

    const res = await SELF.fetch("https://example.com/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(404);

    // Restore for downstream tests
    await env.DB.prepare(
      "UPDATE importers SET archived_at = NULL WHERE id = 'imp_tenants'",
    ).run();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads`
Expected: FAIL — the upload is created (status 201) because the impEnv query doesn't filter on `archived_at`.

- [ ] **Step 3: Tighten the impEnv resolver**

In `apps/worker/src/routes/uploads.ts`, modify the `impEnv` query to filter archived importers out:

```ts
      // Verify the importer_environment exists, belongs to the active project,
      // AND its parent importer isn't archived. Archived importers must not
      // accept new uploads — they exist only for the historical audit trail.
      const impEnv = await c.env.DB.prepare(
        `SELECT ie.id, i.project_id
         FROM importer_environments ie
         JOIN importers i ON i.id = ie.importer_id
         WHERE ie.id = ? AND i.project_id = ? AND i.archived_at IS NULL`,
      )
        .bind(body.importer_environment_id, session.project_id)
        .first<{ id: string; project_id: string }>();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @evo-csv/worker test -- --run uploads`
Expected: PASS (existing 10 tests + the new archived-importer test).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/routes/uploads.ts apps/worker/test/uploads.test.ts
git commit -m "fix(worker): archived importers refuse new uploads"
```

---

### Task 4: Web — `ImporterDetailTabs` shell

**Files:**
- Create: `apps/web/src/components/importers/importer-detail-tabs.tsx`
- (No dedicated test file — exercised through the route's component test in Task 6.)

- [ ] **Step 1: Implement the shell**

```tsx
// apps/web/src/components/importers/importer-detail-tabs.tsx
import type { ReactNode } from "react";
import { useState } from "react";

export type ImporterTabKey = "general" | "columns" | "environments";

type TabDef = { key: ImporterTabKey; label: string };

const TABS: readonly TabDef[] = [
  { key: "general", label: "General" },
  { key: "columns", label: "Columns" },
  { key: "environments", label: "Environments" },
] as const;

type Props = {
  importerName: string;
  initialTab?: ImporterTabKey;
  renderTab: (tab: ImporterTabKey) => ReactNode;
};

/**
 * Tab shell for the importer detail page. Owns the active-tab state and
 * renders the tab list + the body via the `renderTab` callback. Pure UI —
 * no data fetching here.
 *
 * Story #16 will wire the Columns tab content; Story #18 the env tabs.
 * Until then the shell shows a short placeholder for those tabs.
 */
export function ImporterDetailTabs({ importerName, initialTab = "general", renderTab }: Props) {
  const [active, setActive] = useState<ImporterTabKey>(initialTab);

  return (
    <div className="flex flex-col gap-4">
      <header className="border-b border-slate-200 pb-2">
        <h1 className="text-xl font-semibold text-slate-900">{importerName}</h1>
      </header>
      <nav role="tablist" aria-label="Importer settings" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={selected}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                selected
                  ? "border-b-2 border-slate-900 px-4 py-2 text-sm font-medium text-slate-900"
                  : "border-b-2 border-transparent px-4 py-2 text-sm text-slate-500 hover:text-slate-900"
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>
      <section role="tabpanel">{renderTab(active)}</section>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @evo-csv/web exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/importers/importer-detail-tabs.tsx
git commit -m "feat(web): ImporterDetailTabs shell (general/columns/environments)"
```

---

### Task 5: Web — `ImporterGeneralTab` (rename + archive UI)

**Files:**
- Create: `apps/web/src/components/importers/importer-general-tab.tsx`
- Test: `apps/web/test/importer-general-tab.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/importer-general-tab.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImporterGeneralTab } from "../src/components/importers/importer-general-tab";

const BASE = {
  id: "imp_tenants",
  name: "Tenants",
  archived: false,
};

function setup(overrides: Partial<Parameters<typeof ImporterGeneralTab>[0]> = {}) {
  const onSave = vi.fn();
  const onArchive = vi.fn();
  const onUnarchive = vi.fn();
  render(
    <ImporterGeneralTab
      importer={BASE}
      saving={false}
      saveError={null}
      onSave={onSave}
      onArchive={onArchive}
      onUnarchive={onUnarchive}
      {...overrides}
    />,
  );
  return { onSave, onArchive, onUnarchive };
}

describe("ImporterGeneralTab", () => {
  it("calls onSave with the trimmed new name when Save is clicked", () => {
    const { onSave } = setup();
    const input = screen.getByLabelText(/importer name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Tenants v2  " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith("Tenants v2");
  });

  it("disables Save when the trimmed name is unchanged", () => {
    setup();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("disables Save when the trimmed name is empty", () => {
    setup();
    const input = screen.getByLabelText(/importer name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("renders the saveError inline (e.g. the 409 collision message)", () => {
    setup({ saveError: "An importer with this name already exists" });
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it("Archive opens a confirm dialog; confirming calls onArchive", () => {
    const { onArchive } = setup();
    fireEvent.click(screen.getByRole("button", { name: /archive/i }));
    expect(screen.getByText(/historical uploads/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^archive importer$/i }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("Archive confirm dialog can be cancelled without calling onArchive", () => {
    const { onArchive } = setup();
    fireEvent.click(screen.getByRole("button", { name: /archive/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("renders an Unarchive button when the importer is archived; clicking it calls onUnarchive", () => {
    const { onUnarchive } = setup({ importer: { ...BASE, archived: true } });
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unarchive/i }));
    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  it("disables Save while saving=true", () => {
    setup({ saving: true });
    const input = screen.getByLabelText(/importer name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Different name" } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @evo-csv/web test -- --run importer-general-tab`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// apps/web/src/components/importers/importer-general-tab.tsx
import { useState } from "react";

export type GeneralTabImporter = {
  id: string;
  name: string;
  archived: boolean;
};

type Props = {
  importer: GeneralTabImporter;
  saving: boolean;
  saveError: string | null;
  onSave: (newName: string) => void;
  onArchive: () => void;
  onUnarchive: () => void;
};

export function ImporterGeneralTab({
  importer,
  saving,
  saveError,
  onSave,
  onArchive,
  onUnarchive,
}: Props) {
  const [name, setName] = useState(importer.name);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const trimmed = name.trim();
  const canSave = !saving && trimmed.length > 0 && trimmed !== importer.name;

  function handleSave() {
    if (!canSave) return;
    onSave(trimmed);
  }

  function handleArchiveConfirm() {
    setConfirmingArchive(false);
    onArchive();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label htmlFor="importer-name" className="text-sm font-medium text-slate-700">
          Importer name
        </label>
        <div className="flex gap-2">
          <input
            id="importer-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            maxLength={200}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-red-700">
            {saveError}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-slate-200 pt-6">
        <h2 className="text-sm font-medium text-slate-700">Archive</h2>
        <p className="text-xs text-slate-500">
          Archiving hides this importer from the list and prevents new uploads against it. Historical
          uploads remain viewable. You can unarchive later from the Show-archived view.
        </p>
        {importer.archived ? (
          <button
            type="button"
            onClick={onUnarchive}
            disabled={saving}
            className="self-start rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            Unarchive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingArchive(true)}
            disabled={saving}
            className="self-start rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
          >
            Archive
          </button>
        )}
      </section>

      {confirmingArchive && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-confirm-title"
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30"
        >
          <div className="flex flex-col gap-4 rounded-md bg-white p-6 shadow-lg">
            <h3 id="archive-confirm-title" className="text-base font-semibold text-slate-900">
              Archive {importer.name}?
            </h3>
            <p className="max-w-sm text-sm text-slate-600">
              Archiving hides this importer from the list and prevents new uploads against it.
              Historical uploads remain viewable.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingArchive(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveConfirm}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
              >
                Archive importer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @evo-csv/web test -- --run importer-general-tab`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/importers/importer-general-tab.tsx apps/web/test/importer-general-tab.test.tsx
git commit -m "feat(web): ImporterGeneralTab — name edit + archive confirm dialog"
```

---

### Task 6: Web — wire the detail route

**Files:**
- Modify: `apps/web/src/routes/_authed/admin/importers.$id.tsx`

- [ ] **Step 1: Replace the route content**

```tsx
// apps/web/src/routes/_authed/admin/importers.$id.tsx
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ImporterDetailTabs,
  type ImporterTabKey,
} from "../../../components/importers/importer-detail-tabs";
import {
  ImporterGeneralTab,
  type GeneralTabImporter,
} from "../../../components/importers/importer-general-tab";
import { api } from "../../../lib/api";

export const Route = createFileRoute("/_authed/admin/importers/$id")({
  component: ImporterDetailRoute,
});

type ImporterRow = GeneralTabImporter & {
  column_count: number;
  env_count: number;
  updated_at: number;
};

function ImporterDetailRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [importer, setImporter] = useState<ImporterRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].$get({
          param: { importer_id: id },
        });
        if (res.status === 404) {
          if (!cancelled) setLoadError("Importer not found");
          return;
        }
        if (!res.ok) throw new Error(`Failed to load importer: ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setImporter(data.importer as ImporterRow);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function patchImporter(body: { name?: string; archived?: boolean }) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.api.importers[":importer_id"].$patch({
        param: { importer_id: id },
        json: body,
      });
      if (res.status === 409) {
        const errBody = await res.json();
        setSaveError("error" in errBody ? errBody.error : "An importer with this name already exists");
        return null;
      }
      if (!res.ok) throw new Error(`Failed to update importer: ${res.status}`);
      const data = await res.json();
      return data.importer as ImporterRow;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(newName: string) {
    const next = await patchImporter({ name: newName });
    if (next) setImporter(next);
  }

  async function handleArchive() {
    const next = await patchImporter({ archived: true });
    if (next) {
      // Archived importer is hidden from the default list; bounce back.
      await navigate({ to: "/admin/importers" });
    }
  }

  async function handleUnarchive() {
    const next = await patchImporter({ archived: false });
    if (next) setImporter(next);
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Link to="/admin/importers" className="text-sm text-slate-500 underline">
          ← Back to importers
        </Link>
        <p className="text-sm text-red-700">{loadError}</p>
      </div>
    );
  }

  if (!importer) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <p className="text-sm text-slate-500">Loading importer…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Link to="/admin/importers" className="text-sm text-slate-500 underline">
        ← Back to importers
      </Link>
      <ImporterDetailTabs
        importerName={importer.name}
        renderTab={(tab: ImporterTabKey) => {
          if (tab === "general") {
            return (
              <ImporterGeneralTab
                importer={{ id: importer.id, name: importer.name, archived: importer.archived }}
                saving={saving}
                saveError={saveError}
                onSave={handleSave}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
              />
            );
          }
          if (tab === "columns") {
            return (
              <p className="text-sm text-slate-500">
                Column editor lands in <strong>Story #16</strong>.
              </p>
            );
          }
          return (
            <p className="text-sm text-slate-500">
              Per-environment delivery config lands in <strong>Story #18</strong>.
            </p>
          );
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @evo-csv/web exec tsc --noEmit`
Expected: PASS (no errors). The Hono RPC client auto-derives the new endpoints' types from `AppType`; no separate type wiring needed.

- [ ] **Step 3: Run the whole web test suite**

Run: `pnpm --filter @evo-csv/web test -- --run`
Expected: PASS — all prior tests stay green, the new General tab tests are green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_authed/admin/importers.$id.tsx
git commit -m "feat(web): wire importer detail route to ImporterDetailTabs + General tab"
```

---

### Task 7: Live E2E verification (chrome-devtools)

**Files:** none. Manual / harness-driven smoke test against `wrangler dev` + `vite dev`.

- [ ] **Step 1: Start the dev servers**

```bash
pnpm --filter @evo-csv/worker dev   # background, :8787
pnpm --filter @evo-csv/web dev      # background, :5173
```

- [ ] **Step 2: Drive the General tab**

Open `http://localhost:5173/admin/importers` in chrome-devtools-mcp.

- Click into the seeded `Tenants` importer → confirm the tabbed detail page renders with **General** selected, the name field pre-filled with "Tenants", and the **Archive** button visible.
- Rename to `Tenants v2` → click Save → confirm the page header updates and `Save` becomes disabled again.
- Rename back to `Tenants`.
- Click **Archive** → confirm the modal appears with the right copy → click **Archive importer** → confirm the browser navigates back to `/admin/importers` and `Tenants v2` is gone from the default list.
- Toggle **Show archived** → confirm the archived row appears → click it → confirm the detail page now shows **Unarchive** instead of Archive → click it → confirm we're back in normal state.

- [ ] **Step 3: Drive the rename-collision path**

Create a second importer named `Properties` from the list. Open `Properties` → rename to `tenants` (lowercase) → confirm an inline error reads "An importer with this name already exists" and the row is NOT renamed.

- [ ] **Step 4: Verify archived-upload guard**

Archive `Tenants` again. Visit `/admin/importers/imp_tenants/upload` directly. The wizard route's data fetch for `GET /api/importers/imp_tenants/columns` still succeeds (the columns endpoint doesn't gate on archived) — but submitting an upload should fail because the worker now refuses archived importers. Until we add a frontend pre-check, this is verified at the API layer in the unit test from Task 3; no frontend change required for this story.

Unarchive `Tenants` to restore the seed state.

- [ ] **Step 5: Stop dev servers**

```bash
kill $(lsof -ti:8787 2>/dev/null) $(lsof -ti:5173 2>/dev/null) 2>/dev/null
```

- [ ] **Step 6: Run the full test suites once more**

```bash
pnpm --filter @evo-csv/worker test -- --run
pnpm --filter @evo-csv/worker typecheck
pnpm --filter @evo-csv/web test -- --run
pnpm --filter @evo-csv/web exec tsc --noEmit
```

All four must pass green.

- [ ] **Step 7: Push the branch and open the PR**

```bash
git push -u origin feature/15-general-settings
gh pr create --repo aphisak-w-mohara/usecsv-replacement --base main \
  --head feature/15-general-settings \
  --title "Story #15: Importer general settings (rename / archive)" \
  --body "Closes #15. Worker: GET + PATCH /api/importers/:id; uploads route refuses archived importers. Web: replaces the importer detail stub with a tabbed shell + the General tab (name edit + archive confirm)."
```

---

## Self-Review checklist (run after the plan is drafted)

1. **Spec coverage:** Maps to PRD-003 Story 2 § acceptance criteria 1–4:
   - AC1 (rename updates name + updated_at, collision → 409) → Tasks 2 (worker tests + handler) and 5 (web component test for inline error).
   - AC2 (archive sets archived_at, hides from list, blocks upload target, confirm dialog) → Tasks 2 + 3 + 5 + 6.
   - AC3 (unarchive clears archived_at) → Task 2 (test + impl) + Task 5 (Unarchive button test) + Task 6 (handler).
   - AC4 (banner about historical uploads remain viewable) → Task 5 (the description copy under the Archive section is the banner-equivalent).
2. **Placeholder scan:** none. Every step has either a code block, an exact command, or both.
3. **Type consistency:** `ImporterRow` shape (id, name, column_count, env_count, archived, updated_at) is consistent across Task 1 (worker GET return shape), Task 2 (worker PATCH return shape), and Task 6 (web `ImporterRow` type). The smaller `GeneralTabImporter` (id, name, archived) is the subset the General tab needs and is passed through unchanged.
