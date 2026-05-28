# Story #16 — Column add / edit / remove

> Branched from `feature/15-general-settings` (depends on the Columns tab shell).

## Goal
Make the **Columns** tab on the importer detail page support adding, editing, and removing columns. Reordering is #17 — out of scope here.

## Worker endpoints

1. `POST /api/importers/:importer_id/columns` — create
2. `PATCH /api/importers/:importer_id/columns/:column_id` — partial update
3. `DELETE /api/importers/:importer_id/columns/:column_id` — remove

All chained onto `importersRoutes`. All scoped via `session.project_id`; cross-project → 404. Files: `apps/worker/src/routes/importers.ts`, tests in `apps/worker/test/importers.test.ts`.

### Schema (request bodies)

```ts
// POST + PATCH common fields (POST: name + display_name + validation_type required; PATCH: all optional)
{
  name: string,                  // ^[a-z][a-z0-9_]*$, max 100
  display_name: string,          // 1..200
  description?: string | null,   // max 500
  example?: string | null,       // max 200
  must_be_matched?: boolean,
  value_cannot_be_blank?: boolean,
  validation_type?: "string" | "number" | "email" | "phone" | "url" | "date" | "select" | "regex",
  validation_format?: string | null  // options list for select; regex pattern; ISO format hint for date
}
```

### Behavior

- **POST** assigns `position = (SELECT COALESCE(MAX(position), 0) + 1 FROM importer_columns WHERE importer_id = ?)`; returns 201 with the new column row. Duplicate `name` within importer → 409. Invalid `name` regex → 400. `validation_type` defaults to `"string"` if omitted.
- **PATCH** updates only supplied fields; bumps importer's `updated_at`. Cross-importer column id → 404. Name change to existing-on-importer → 409.
- **DELETE** removes the row. Uploads keep their snapshot via `uploads.matched_columns_map` / `uploaded_file_headers` JSON (already snapshotted at upload time). Returns 204.

### Tests (worker, ~12)
- POST: happy path, duplicate name → 409, invalid name regex → 400, cross-project → 404, position = max+1 (sequential).
- PATCH: rename, change validation_type, partial update keeps other fields, duplicate name → 409, cross-importer → 404.
- DELETE: removes the row, returns 204, cross-project → 404.

## Web components

Files (new):
- `apps/web/src/components/importers/columns-tab.tsx` — fetches columns, renders table + Add button, handles add/edit/delete via the worker API.
- `apps/web/src/components/importers/column-editor.tsx` — shared form (modal) for add + edit. Fields per AC. Validates `name` regex client-side.
- `apps/web/src/components/importers/column-row.tsx` — one row in the columns table with Edit / Remove buttons. (Inline file is OK if rows stay simple.)

Wire into `apps/web/src/routes/_authed/admin/importers.$id.tsx` — replace the `tab === "columns"` placeholder with `<ColumnsTab importerId={importer.id} />`.

**Persistent banner** at top of Columns tab: amber/info, copy: *"Column changes affect all environments including production."*

### Tests (web, ~6)
- `column-editor.test.tsx` — fields render, name regex client-side validation, validation_format hides for non-select/non-regex types.
- `columns-tab.test.tsx` — lists fetched columns, opens editor on Add, calls API on save, removes on Remove (with confirm).

## Order of work
1. Worker POST + tests
2. Worker PATCH + tests
3. Worker DELETE + tests
4. Web `ColumnEditor` + tests
5. Web `ColumnsTab` + tests
6. Wire into route, full test suite + typecheck, push, PR
