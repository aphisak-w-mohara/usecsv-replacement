# Story #17 — Column reorder

> Stacked on `feature/16-columns-crud`.

## Worker
- `PUT /api/importers/:importer_id/columns/order { ordered_ids: string[] }`.
- Validate: project-scope importer (404 on cross), column set match (400 on missing/extra/dup), non-empty.
- Two-pass `D1.batch()` to avoid `UNIQUE(importer_id, position)` collisions:
  1. Update each row to `position = -1`, `-2`, ... (negative temp values, in body order).
  2. Update each row to its final `position = i+1`.
- Bump importer `updated_at`. Return the fresh column list (same shape as GET).

Files: `apps/worker/src/routes/importers.ts`, tests appended to `apps/worker/test/importers.test.ts`.

## Web
- Update `ColumnsTab`:
  - Add ▲/▼ buttons per row (disabled at top/bottom).
  - HTML5 drag-and-drop on `<tr>` rows.
  - Optimistic local reorder, then `PUT`. On failure: revert + show toast/error.
- Wrap order-changing logic in a `reorderColumns(ids: string[])` helper for testability.

Files: extend `apps/web/src/components/importers/columns-tab.tsx`. Tests in a new `apps/web/test/columns-tab.test.tsx` (keyboard ▲/▼ behavior; drag is best left to live smoke).

## Order of work
1. Worker endpoint + tests.
2. Web reorder buttons + drag + tests.
3. Push, PR.
