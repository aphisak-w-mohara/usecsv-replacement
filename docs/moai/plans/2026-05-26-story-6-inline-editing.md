# Story #6 — Inline Cell Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Step 3b of the upload wizard — add click-to-edit on top of Story #5's read-only review grid so dev team members can fix validation errors in place before submitting. Validation re-runs only for the edited cell (not the whole grid); the summary chip and filter view update in real time.

**Architecture:** Refactor `step-review-grid.tsx` to promote the validation cache from `useMemo` to `useState`, add an internal `rows` state seeded from the prop, and introduce an `EditableCell` sub-component that handles click-to-edit + Enter/Tab/Esc. On commit, only the edited cell's validation runs — the cache Map is mutated in place (creating a new outer reference to trigger re-render). Counts are derived from a separate `useState` that updates alongside the cache. The route's `state` gains an `edited_rows` field so Story #7's submit has the user's edits, not the original parse output.

**Tech Stack:** No new deps. Reuses TanStack Table + TanStack Virtual + `validateCell` from Story #5.

**Maps to GitHub Issue:** [#6 — Inline cell editing + revalidation](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/6)

**Parent Epic:** [#1 — Upload Wizard](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/1)

**Spec references:**
- [`prds/prd-feature-upload-wizard.md`](../../../prds/prd-feature-upload-wizard.md) — Story 4b in §5.4 (inline editing half)
- Story #5's final review (commit `aa3dcae`) — pre-staged this story's two architectural concerns:
  1. Cache must be `useState`, not `useMemo`
  2. Need internal `rows` state + `onRowsChanged` / `onConfirmed(editedRows)` callback so the route can collect edits

---

## File Structure

```
evo-usecsv/
└── apps/web/
    ├── src/
    │   ├── components/upload-wizard/
    │   │   ├── step-review-grid.tsx                       [M] state refactor + editable cell
    │   │   └── editable-cell.tsx                          [N] click-to-edit + commit/cancel logic
    │   └── routes/_authed/admin/
    │       └── importers.$id.upload.tsx                   [M] capture edited_rows from onConfirmed
    └── test/
        ├── step-review-grid.test.tsx                      [M] add ~5 inline-editing test cases
        └── editable-cell.test.tsx                         [N] standalone tests for the cell behaviour
```

**Design notes:**
- `EditableCell` is a self-contained sub-component. It receives `value`, `validationResult`, and `onCommit(newValue)` + `onCancel()` callbacks. It owns the editing state (idle vs editing) and the input ref. This keeps the grid simple — the grid only knows "here's a cell, render it" — and lets us unit-test the cell behaviour in isolation without the surrounding virtualizer.
- The validation cache goes from immutable (`useMemo`) to mutable (`useState`). Incremental updates patch the cache Map in place AND replace the outer Map reference (`setCache(new Map(prev))`) so React re-renders.
- Cell value cap (64 KB) is enforced at commit time in `EditableCell`; the previous value is restored on overflow.
- Keyboard navigation (Tab advances to next cell in row, Enter commits) is part of `EditableCell`. Arrow-key navigation when NOT in edit mode is explicitly out of scope (a nice-to-have for a future iteration — flagged in the plan, not required by AC).
- Story #5's prop interface added `onConfirmed: () => void`. This story changes it to `onConfirmed: (editedRows: Record<string, string>[]) => void` so the route gets the edits.

---

## Shared types

The `EditableCell` props live in its own file:

```ts
// apps/web/src/components/upload-wizard/editable-cell.tsx
import type { CellValidationResult } from "../../lib/validators";

export const MAX_CELL_BYTES = 64 * 1024; // 64 KB

export type EditableCellProps = {
  value: string;
  validation: CellValidationResult | undefined;
  onCommit: (newValue: string) => void;
};
```

`StepReviewGridProps` (in `step-review-grid.tsx`) keeps the same shape except `onConfirmed`:

```ts
// Story #5: onConfirmed: () => void;
// Story #6:
onConfirmed: (editedRows: Record<string, string>[]) => void;
```

---

# Phase 1 — State refactor (Task 1)

### Task 1: Promote validation cache to useState + introduce rows state (no UI change)

**Files:**
- Modify: `apps/web/src/components/upload-wizard/step-review-grid.tsx`

This task is a **pure refactor** — the visible behaviour does not change. All 7 existing `step-review-grid.test.tsx` cases must continue to pass without modification. The Story #5 reviewer's architectural pre-staging notes apply:

1. Change the validation cache from `useMemo([rows, importerColumns, matched])` to `useState` initialized once via a function form. Add a parallel `useState` for the error count + warning count + error row indices (derived data that updates with the cache).
2. Add an internal `rows` state seeded from the `rows` prop. The grid now reads from this internal state, not the prop. Currently there's no edit affordance, so this is invisible — but the affordance lands in Task 2.

- [ ] **Step 1: Run the existing test suite to capture the baseline**

Run: `pnpm --filter @evo-csv/web test step-review-grid`
Expected: 7 tests pass.

- [ ] **Step 2: Refactor the component**

Replace `apps/web/src/components/upload-wizard/step-review-grid.tsx` with:

```tsx
import { useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ImporterColumn } from "../../lib/fuzzy-match";
import { validateCell, type CellValidationResult } from "../../lib/validators";

const VIRTUALIZE_THRESHOLD = 50;

export type StepReviewGridProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  matched: Record<string, string>;
  filterInvalidRows: boolean;
  disableIfAnyInvalid: boolean;
  onConfirmed: (editedRows: Record<string, string>[]) => void;
  onBack: () => void;
};

type ValidationCache = Map<number, Map<string, CellValidationResult>>;

type RowWithMeta = {
  __rowIndex: number;
  __hasError: boolean;
  __original: Record<string, string>;
};

/**
 * Compute the initial cache + counts from the prop rows. Used once at
 * mount via useState's lazy initializer.
 */
function buildInitialCache(
  rows: Record<string, string>[],
  importerColumns: ImporterColumn[],
  matched: Record<string, string>,
): { cache: ValidationCache; errorCount: number; warningCount: number; errorRowIndices: Set<number> } {
  const cache: ValidationCache = new Map();
  const errorRowSet = new Set<number>();
  let errorCount = 0;
  let warningCount = 0;

  rows.forEach((row, rowIdx) => {
    const cellCache = new Map<string, CellValidationResult>();
    for (const column of importerColumns) {
      const fileHeader = matched[column.name];
      if (!fileHeader) continue;
      const value = row[fileHeader] ?? "";
      const result = validateCell(value, column);
      cellCache.set(column.name, result);
      if (!result.ok) {
        if (result.severity === "error") {
          errorCount++;
          errorRowSet.add(rowIdx);
        } else {
          warningCount++;
        }
      }
    }
    cache.set(rowIdx, cellCache);
  });

  return { cache, errorCount, warningCount, errorRowIndices: errorRowSet };
}

export function StepReviewGrid({
  fileHeaders: _fileHeaders,
  rows: propRows,
  importerColumns,
  matched,
  filterInvalidRows,
  disableIfAnyInvalid,
  onConfirmed,
  onBack,
}: StepReviewGridProps) {
  // Internal editable copy. propRows is treated as the initial value only —
  // we never sync back to it after mount.
  const [rows, setRows] = useState(() => propRows.map((r) => ({ ...r })));

  // Validation cache + counts. All mutated together when a cell is edited.
  const [validation, setValidation] = useState(() =>
    buildInitialCache(rows, importerColumns, matched),
  );
  const { cache, errorCount, warningCount, errorRowIndices } = validation;

  // The cell editor will call this when a cell commits. It updates rows,
  // re-runs validateCell for ONLY the edited cell, and patches the cache +
  // counts incrementally — no full recompute.
  // Story #6 Task 2 will wire EditableCell to call this.
  function _commitCellEdit(rowIdx: number, columnName: string, newValue: string) {
    const column = importerColumns.find((c) => c.name === columnName);
    if (!column) return;
    const fileHeader = matched[columnName];
    if (!fileHeader) return;

    setRows((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx]!, [fileHeader]: newValue };
      return next;
    });

    const oldResult = cache.get(rowIdx)?.get(columnName);
    const newResult = validateCell(newValue, column);

    setValidation((prev) => {
      const nextCache: ValidationCache = new Map(prev.cache);
      const nextCellCache = new Map(nextCache.get(rowIdx) ?? new Map());
      nextCellCache.set(columnName, newResult);
      nextCache.set(rowIdx, nextCellCache);

      // Recompute counts incrementally — fast path, no full grid scan.
      let nextErrors = prev.errorCount;
      let nextWarnings = prev.warningCount;
      const nextErrorRows = new Set(prev.errorRowIndices);

      if (oldResult && !oldResult.ok) {
        if (oldResult.severity === "error") nextErrors--;
        else nextWarnings--;
      }
      if (!newResult.ok) {
        if (newResult.severity === "error") nextErrors++;
        else nextWarnings++;
      }

      // Recompute whether THIS ROW still has any error.
      let rowStillHasError = false;
      for (const r of nextCellCache.values()) {
        if (!r.ok && r.severity === "error") {
          rowStillHasError = true;
          break;
        }
      }
      if (rowStillHasError) nextErrorRows.add(rowIdx);
      else nextErrorRows.delete(rowIdx);

      return {
        cache: nextCache,
        errorCount: nextErrors,
        warningCount: nextWarnings,
        errorRowIndices: nextErrorRows,
      };
    });
  }
  // Silence unused-var warning in Task 1 — the wire-up happens in Task 2.
  void _commitCellEdit;

  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  const tableRows: RowWithMeta[] = [];
  rows.forEach((row, rowIdx) => {
    const hasError = errorRowIndices.has(rowIdx);
    if (showOnlyErrors && !hasError) return;
    tableRows.push({
      __rowIndex: rowIdx + 1,
      __hasError: hasError,
      __original: row,
    });
  });

  const mappedColumns = importerColumns.filter((c) => matched[c.name]);

  const columns: ColumnDef<RowWithMeta>[] = [
    {
      id: "__rowIndex",
      header: "#",
      size: 60,
      cell: (info) => (
        <span className="text-slate-400">{info.row.original.__rowIndex}</span>
      ),
    },
  ];
  for (const col of mappedColumns) {
    columns.push({
      id: col.name,
      header: col.display_name,
      size: 160,
      accessorFn: (row) => row.__original[matched[col.name]!] ?? "",
      cell: (info) => {
        const rowIdx = info.row.original.__rowIndex - 1;
        const result = cache.get(rowIdx)?.get(col.name);
        const value = info.getValue() as string;
        const isError = result && !result.ok && result.severity === "error";
        const isWarn = result && !result.ok && result.severity === "warning";
        return (
          <span
            title={result && !result.ok ? result.message : undefined}
            className={
              isError
                ? "block bg-red-50 px-2 text-red-900"
                : isWarn
                  ? "block bg-yellow-50 px-2 text-yellow-900"
                  : "block px-2"
            }
          >
            {isError ? "⚠ " : ""}
            {value}
          </span>
        );
      },
    });
  }

  const table = useReactTable({
    data: tableRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = tableRows.length > VIRTUALIZE_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? tableRows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  });
  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : null;

  const blockedByInvalidGate = disableIfAnyInvalid && errorCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; submit</h2>
        <p className="text-sm text-slate-600">
          Each mapped cell has been validated against your importer schema. Errors are highlighted
          in red — you'll be able to edit cells inline in the next step.
        </p>
      </header>

      <div className="flex items-center gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <span>
          {rows.length.toLocaleString("en-US")} rows
        </span>
        <span>·</span>
        <span className={errorCount > 0 ? "text-red-700" : "text-slate-600"}>
          {errorCount} error{errorCount === 1 ? "" : "s"}
        </span>
        <span>·</span>
        <span className={warningCount > 0 ? "text-yellow-700" : "text-slate-600"}>
          {warningCount} warning{warningCount === 1 ? "" : "s"}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showOnlyErrors}
            onChange={(e) => setShowOnlyErrors(e.target.checked)}
          />
          Show only errors
        </label>
      </div>

      {blockedByInvalidGate && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Imports with errors are blocked for this importer — fix all errors to continue.
        </div>
      )}

      <div
        ref={parentRef}
        className="h-[480px] overflow-auto rounded-md border border-slate-200"
      >
        <table className="min-w-full text-xs" style={{ width: "100%" }}>
          <thead className="sticky top-0 bg-slate-100">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.column.getSize() }}
                    className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {virtualItems
              ? virtualItems.map((virtualRow) => {
                  const row = table.getRowModel().rows[virtualRow.index]!;
                  return (
                    <tr
                      key={row.id}
                      style={{ height: `${virtualRow.size}px` }}
                      className="border-b border-slate-100"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          style={{ width: cell.column.getSize() }}
                          className="p-0"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })
              : table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className="p-0"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {filterInvalidRows && errorCount > 0 && (
        <p className="text-xs text-slate-500">
          {errorRowIndices.size} row{errorRowIndices.size === 1 ? "" : "s"} will be excluded due to errors.
        </p>
      )}

      {tableRows.length === 0 && showOnlyErrors && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          🎉 No errors. Untick "Show only errors" to see all rows.
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
          onClick={() => onConfirmed(rows)}
          disabled={blockedByInvalidGate}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Next
        </button>
      </footer>
    </div>
  );
}
```

**Key changes from Story #5's version:**

1. `useMemo` cache replaced by `useState<{ cache, errorCount, warningCount, errorRowIndices }>(() => buildInitialCache(...))`.
2. `rows` is now a `useState` (deep-copied from `propRows` at mount). The grid never reads `propRows` after that.
3. `onConfirmed()` becomes `onConfirmed(rows)` — passes the (possibly edited) rows up.
4. Internal helper `_commitCellEdit(rowIdx, columnName, newValue)` is defined but not yet wired to a UI affordance. Task 2 will wire it in via `EditableCell`. The `void _commitCellEdit;` line suppresses the unused-var warning until then.
5. Cell rendering is unchanged — still a `<span>` with the validation styling. Click-to-edit is added in Task 2.

- [ ] **Step 3: Run tests — all 7 existing tests must still pass**

Run: `pnpm --filter @evo-csv/web test step-review-grid`
Expected: 7 PASS. **No test changes in this task.** If any test fails, the refactor broke something — debug before proceeding.

Full suite check:
Run: `pnpm --filter @evo-csv/web test`
Expected: 86 tests pass (same total as before).

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @evo-csv/web build`
Expected: clean.

- [ ] **Step 5: Run pnpm format**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-review-grid.tsx
git commit -m "refactor(web): promote review-grid cache + rows to useState

Pre-stage for Story #6's inline editing. The validation cache and
counts now live in a single useState (was useMemo); rows live in a
separate useState deep-copied from the prop. onConfirmed now passes
the (possibly edited) rows up. Internal _commitCellEdit helper is
defined for Task 2 to wire in via EditableCell — no UI affordance
yet, so behaviour is unchanged. All 7 existing tests still pass."
```

---

# Phase 2 — Editing UI (Tasks 2–3)

### Task 2: EditableCell component (TDD red→green)

**Files:**
- Create: `apps/web/src/components/upload-wizard/editable-cell.tsx`
- Create: `apps/web/test/editable-cell.test.tsx`

A self-contained sub-component. Owns its own editing state. Receives `value`, optional `validation`, `onCommit`. On click: enters edit mode (renders `<input>`). On Enter or Tab: calls `onCommit(newValue)` and exits edit mode. On Esc: discards and exits. On Tab specifically: also calls `e.preventDefault()` so the browser doesn't move focus elsewhere — but we'll let the natural tab-key behaviour move focus to the next focusable element AFTER the input unmounts.

Cell value cap: 64 KB. On commit, if `new TextEncoder().encode(value).byteLength > 64 * 1024`, the commit is rejected — `onCommit` is NOT called, the input retains the user's typed value, and a `role="alert"` element appears with the message. This lets the user fix the input without losing it.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/editable-cell.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditableCell } from "../src/components/upload-wizard/editable-cell";

describe("EditableCell", () => {
  it("renders the value as plain text initially (idle mode)", () => {
    render(<EditableCell value="alice@example.com" validation={{ ok: true }} onCommit={() => {}} />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("enters edit mode on click and pre-fills the input with the current value", () => {
    render(<EditableCell value="alice@example.com" validation={{ ok: true }} onCommit={() => {}} />);
    fireEvent.click(screen.getByText("alice@example.com"));
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("alice@example.com");
  });

  it("commits on Enter and calls onCommit with the new value", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("new");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("commits on Tab and calls onCommit with the new value", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onCommit).toHaveBeenCalledWith("new");
  });

  it("cancels on Escape and does NOT call onCommit", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    // Original value still visible
    expect(screen.getByText("old")).toBeInTheDocument();
  });

  it("rejects values over 64 KB and keeps the input open with an alert", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="ok" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("ok"));
    const input = screen.getByRole("textbox");
    const giant = "x".repeat(70 * 1024); // 70 KB > 64 KB cap
    fireEvent.change(input, { target: { value: giant } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    // Input stays open with the user's typed value
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
  });

  it("commits on blur (clicking away)", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("new");
  });

  it("renders error styling + tooltip when validation is failing", () => {
    const failingValidation = {
      ok: false as const,
      severity: "error" as const,
      message: "Not a valid email address.",
    };
    render(<EditableCell value="bad" validation={failingValidation} onCommit={() => {}} />);
    const cell = screen.getByTitle(/not a valid email/i);
    expect(cell).toBeInTheDocument();
    expect(cell.textContent).toContain("bad");
    // Error prefix
    expect(cell.textContent).toMatch(/⚠/);
  });
});
```

- [ ] **Step 2: Create the stub**

Create `apps/web/src/components/upload-wizard/editable-cell.tsx`:

```tsx
import type { CellValidationResult } from "../../lib/validators";

export const MAX_CELL_BYTES = 64 * 1024;

export type EditableCellProps = {
  value: string;
  validation: CellValidationResult | undefined;
  onCommit: (newValue: string) => void;
};

export function EditableCell(_props: EditableCellProps) {
  return null;
}
```

- [ ] **Step 3: Run + verify FAIL**

Run: `pnpm --filter @evo-csv/web test editable-cell`
Expected: 8 FAILS — stub renders nothing.

- [ ] **Step 4: Commit (RED)**

```bash
git add apps/web/src/components/upload-wizard/editable-cell.tsx apps/web/test/editable-cell.test.tsx
git commit -m "test(web): add failing tests for EditableCell"
```

- [ ] **Step 5: Implement the component**

Replace `apps/web/src/components/upload-wizard/editable-cell.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { CellValidationResult } from "../../lib/validators";

export const MAX_CELL_BYTES = 64 * 1024; // 64 KB

export type EditableCellProps = {
  value: string;
  validation: CellValidationResult | undefined;
  onCommit: (newValue: string) => void;
};

export function EditableCell({ value, validation, onCommit }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [tooLarge, setTooLarge] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function tryCommit() {
    const byteLen = new TextEncoder().encode(draft).byteLength;
    if (byteLen > MAX_CELL_BYTES) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    onCommit(draft);
    setEditing(false);
  }

  function cancel() {
    setDraft(value);
    setTooLarge(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="relative block">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (tooLarge) setTooLarge(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              tryCommit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={tryCommit}
          className="block w-full bg-white px-2 py-0.5 outline outline-2 outline-blue-500"
        />
        {tooLarge && (
          <span
            role="alert"
            className="absolute left-0 top-full z-10 mt-0.5 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700"
          >
            Cell value too large (over 64 KB)
          </span>
        )}
      </span>
    );
  }

  const isError =
    validation && !validation.ok && validation.severity === "error";
  const isWarn =
    validation && !validation.ok && validation.severity === "warning";

  return (
    <span
      onClick={() => setEditing(true)}
      title={validation && !validation.ok ? validation.message : undefined}
      className={
        isError
          ? "block cursor-pointer bg-red-50 px-2 text-red-900 hover:bg-red-100"
          : isWarn
            ? "block cursor-pointer bg-yellow-50 px-2 text-yellow-900 hover:bg-yellow-100"
            : "block cursor-pointer px-2 hover:bg-slate-100"
      }
    >
      {isError ? "⚠ " : ""}
      {value}
    </span>
  );
}
```

- [ ] **Step 6: Run + verify PASS**

Run: `pnpm --filter @evo-csv/web test editable-cell`
Expected: 8 PASS.

If the "rejects values over 64 KB" test fails because `fireEvent.change` on a 70 KB string is slow but works — that's fine. If it fails because the alert doesn't appear, check that `setTooLarge(true)` runs in `tryCommit` AND the input remains rendered.

If "commits on blur" double-fires `onCommit` because Enter/Tab also fire blur — check the ordering of `tryCommit` calls. The `onBlur` handler calls `tryCommit` once; Enter's keydown also calls it, but by then we've already called `setEditing(false)` from the first commit which unmounts the input, so the blur fires AFTER unmount which is a no-op. If this is causing duplicate commits, guard with `if (!editing) return;` in the blur handler.

Full suite check:
Run: `pnpm --filter @evo-csv/web test`
Expected: 94 tests pass (86 prior + 8 new).

- [ ] **Step 7: Run pnpm format**

- [ ] **Step 8: Commit (GREEN)**

```bash
git add apps/web/src/components/upload-wizard/editable-cell.tsx
git commit -m "feat(web): implement EditableCell with click-to-edit + 64KB cap

Single-click enters edit mode; Enter/Tab commits; Esc cancels;
clicking away (blur) also commits. Values over 64 KB are rejected
with an inline alert and the input stays open so the user can
trim. Error/warning validation styling is preserved in idle mode."
```

---

### Task 3: Wire EditableCell into the grid + extend tests for live edits

**Files:**
- Modify: `apps/web/src/components/upload-wizard/step-review-grid.tsx`
- Modify: `apps/web/test/step-review-grid.test.tsx`

Replace the inline cell renderer in the grid with `<EditableCell>` and wire its `onCommit` to the existing `_commitCellEdit` helper. Add 4 new tests for the edit flow.

- [ ] **Step 1: Wire EditableCell into the grid**

In `apps/web/src/components/upload-wizard/step-review-grid.tsx`:

Replace the `cell` renderer in the `for (const col of mappedColumns)` loop. The OLD block was:

```tsx
cell: (info) => {
  const rowIdx = info.row.original.__rowIndex - 1;
  const result = cache.get(rowIdx)?.get(col.name);
  const value = info.getValue() as string;
  const isError = result && !result.ok && result.severity === "error";
  const isWarn = result && !result.ok && result.severity === "warning";
  return (
    <span
      title={result && !result.ok ? result.message : undefined}
      className={
        isError
          ? "block bg-red-50 px-2 text-red-900"
          : isWarn
            ? "block bg-yellow-50 px-2 text-yellow-900"
            : "block px-2"
      }
    >
      {isError ? "⚠ " : ""}
      {value}
    </span>
  );
},
```

Replace with:

```tsx
cell: (info) => {
  const rowIdx = info.row.original.__rowIndex - 1;
  const result = cache.get(rowIdx)?.get(col.name);
  const value = info.getValue() as string;
  return (
    <EditableCell
      value={value}
      validation={result}
      onCommit={(newValue) => _commitCellEdit(rowIdx, col.name, newValue)}
    />
  );
},
```

Also add the import at the top of `step-review-grid.tsx`:

```tsx
import { EditableCell } from "./editable-cell";
```

And **remove the `void _commitCellEdit;` line** — it's now used.

- [ ] **Step 2: Run existing tests — must still pass**

Run: `pnpm --filter @evo-csv/web test step-review-grid`
Expected: 7 PASS — all previously-passing tests still work because `EditableCell` renders the same visible content in idle mode.

If "flags the bad email cell and surfaces its message via title attribute" fails because the cell is now wrapped differently, check that the `<span>` rendered by `EditableCell` in idle mode still has the `title` attribute. The implementation in Task 2 does — verify.

- [ ] **Step 3: Add the new edit-flow tests**

Append these to `apps/web/test/step-review-grid.test.tsx` inside the existing `describe("StepReviewGrid", ...)` block:

```tsx
it("re-validates only the edited cell on commit and updates the summary", async () => {
  const ONE_BAD_EMAIL_ROW = [
    { "First name": "Alice", "Last name": "Smith", "Customer Email": "alice@example.com" },
    { "First name": "Bob", "Last name": "Jones", "Customer Email": "not-an-email" },
    { "First name": "Carol", "Last name": "Lee", "Customer Email": "carol@example.com" },
  ];
  renderGrid({ rows: ONE_BAD_EMAIL_ROW });

  // Initially 1 error
  expect(screen.getByText(/1 error/i)).toBeInTheDocument();

  // Click the bad cell, type a valid email, commit
  fireEvent.click(screen.getByTitle(/not a valid email/i));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "bob.fixed@example.com" } });
  fireEvent.keyDown(input, { key: "Enter" });

  // Summary now shows 0 errors
  expect(screen.getByText(/0 errors/i)).toBeInTheDocument();
  // The new value is visible (not the original "not-an-email")
  expect(screen.getByText("bob.fixed@example.com")).toBeInTheDocument();
  expect(screen.queryByText("not-an-email")).not.toBeInTheDocument();
});

it("removes a row from 'show only errors' view after its error is fixed", () => {
  const ONE_BAD_EMAIL_ROW = [
    { "First name": "Alice", "Last name": "Smith", "Customer Email": "alice@example.com" },
    { "First name": "Bob", "Last name": "Jones", "Customer Email": "not-an-email" },
    { "First name": "Carol", "Last name": "Lee", "Customer Email": "carol@example.com" },
  ];
  renderGrid({ rows: ONE_BAD_EMAIL_ROW });

  fireEvent.click(screen.getByRole("checkbox", { name: /show only errors/i }));
  // Row 2 is now the only visible row
  expect(screen.getByText("2")).toBeInTheDocument();

  // Fix the cell
  fireEvent.click(screen.getByTitle(/not a valid email/i));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "bob.fixed@example.com" } });
  fireEvent.keyDown(input, { key: "Enter" });

  // Filtered view is now empty; the success message appears
  expect(screen.queryByText("2")).not.toBeInTheDocument();
  expect(screen.getByText(/no errors/i)).toBeInTheDocument();
});

it("preserves the original value when the user presses Escape", () => {
  renderGrid();
  fireEvent.click(screen.getByText("Alice"));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "EDITED" } });
  fireEvent.keyDown(input, { key: "Escape" });
  // Original "Alice" is back; "EDITED" was discarded
  expect(screen.getByText("Alice")).toBeInTheDocument();
  expect(screen.queryByText("EDITED")).not.toBeInTheDocument();
});

it("passes the edited rows to onConfirmed (not the originals)", () => {
  const onConfirmed = vi.fn();
  renderGrid({ onConfirmed });

  // Edit one cell
  fireEvent.click(screen.getByText("Alice"));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "Alicia" } });
  fireEvent.keyDown(input, { key: "Enter" });

  // Click Next
  fireEvent.click(screen.getByRole("button", { name: /^next$/i }));

  expect(onConfirmed).toHaveBeenCalledTimes(1);
  const editedRows = onConfirmed.mock.calls[0]?.[0] as Record<string, string>[];
  expect(editedRows).toHaveLength(3);
  expect(editedRows[0]?.["First name"]).toBe("Alicia"); // edited
  expect(editedRows[1]?.["First name"]).toBe("Bob"); // unchanged
});
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @evo-csv/web test`
Expected: 98 tests pass (94 prior + 4 new).

If "re-validates only the edited cell" fails because the summary chip still shows the old count, the issue is that `setValidation` isn't triggering a re-render — check that `_commitCellEdit` calls `setValidation(...)` with a new outer object reference (it does — `{ cache: nextCache, errorCount: ..., ... }` is a fresh object).

If "passes the edited rows" fails because `editedRows[0]?.["First name"]` is still "Alice", the `setRows` updater isn't running before the click — wait, `setRows` is synchronous via the functional updater. The test renders, fires events synchronously, and then asserts. Should work. If it doesn't, check that the `cell` renderer's `onCommit` calls `_commitCellEdit` which calls BOTH `setRows` AND `setValidation`.

- [ ] **Step 5: Run pnpm format**

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/upload-wizard/step-review-grid.tsx apps/web/test/step-review-grid.test.tsx
git commit -m "feat(web): wire EditableCell into StepReviewGrid + tests

Cell editor is now click-to-edit. _commitCellEdit (added in Task 1)
patches the cache incrementally — single cell re-validation, count
adjustment for that cell only, and row-error tracking. No full
grid recompute on each keystroke. Four new tests cover: live
re-validation, filter view update, Escape revert, and onConfirmed
receiving edited rows."
```

---

### Task 4: Route integration + E2E smoke

**Files:**
- Modify: `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`

The `handleReviewed` callback now receives `editedRows: Record<string, string>[]` and stashes it in route state for Story #7's submit.

- [ ] **Step 1: Update the route**

In `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`:

Update the `WizardState` type:

```ts
type WizardState = {
  context: StepContextSubmit | null;
  parsed: ParseSuccess | null;
  matched: Record<string, string> | null;
  reviewed: boolean;
  editedRows: Record<string, string>[] | null; // NEW
};
```

Update the initial `useState`:

```ts
const [state, setState] = useState<WizardState>({
  context: null,
  parsed: null,
  matched: null,
  reviewed: false,
  editedRows: null,
});
```

Update `handleReviewed`:

```ts
function handleReviewed(editedRows: Record<string, string>[]) {
  setState((s) => {
    // TODO(Story #7): replace this with the actual submit + batch dispatch
    // using s.context + s.parsed + s.matched + editedRows (the user-fixed
    // rows). Story #7 will POST /api/uploads then chunk the rows.
    console.info("[wizard] step 3 -> step 4 (Story #7)", {
      context: s.context,
      parsed: s.parsed,
      matched: s.matched,
      editedRows,
    });
    return { ...s, reviewed: true, editedRows };
  });
}
```

Update the `StepReviewGrid` mount to pass the updated callback (the signature now matches what the component expects):

```tsx
{activeStep === 3 && state.parsed && state.matched && importerColumns && (
  <StepReviewGrid
    fileHeaders={state.parsed.headers}
    rows={state.parsed.rows}
    importerColumns={importerColumns}
    matched={state.matched}
    filterInvalidRows={false}
    disableIfAnyInvalid={false}
    onConfirmed={handleReviewed}
    onBack={() => setActiveStep(2)}
  />
)}
```

And update the post-review hint to reflect the captured row count:

```tsx
{state.reviewed && state.editedRows && (
  <p className="mt-4 text-xs text-slate-500">
    Step 3 captured ({state.editedRows.length} rows ready for submit). Step 4 (submit + batch dispatch) lands in Story #7.
  </p>
)}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @evo-csv/web build`
Expected: clean.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: 20 worker + 98 web = **118 tests** pass.

- [ ] **Step 4: Curl smoke**

Start both servers:
```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 8
```

Verify both reachable:
```bash
curl -s -o /dev/null -w "worker: %{http_code}\n" http://localhost:8787/api/health
curl -s -o /dev/null -w "web: %{http_code}\n" http://localhost:5173/
```
Expected: both `200`.

Cleanup:
```bash
kill $DEV_PID 2>/dev/null
pkill -f "wrangler.*dev" 2>/dev/null
pkill -f "vite/bin/vite" 2>/dev/null
sleep 1
```

For the manual walkthrough (not automatable):
1. Walk Steps 0-2 with `sample-tenants.csv`
2. Step 3 grid appears with 3 rows, all green
3. Click on "Alice" → input appears pre-filled with "Alice"; type "Alicia", press Enter → cell now reads "Alicia"
4. Click on "alice@example.com" → input → type "broken" + Enter → cell goes red with ⚠ prefix, summary shows "1 error"
5. Click the bad cell again → fix to "alice@example.com" + Enter → summary back to "0 errors"
6. Toggle "Show only errors" mid-flow to verify filter responsiveness
7. Click Next → DevTools console: `[wizard] step 3 -> step 4 (Story #7)` with `editedRows` showing Alice changed to Alicia
8. "Step 3 captured (3 rows ready for submit). Step 4 (submit + batch dispatch) lands in Story #7." appears

- [ ] **Step 5: Run pnpm format**

- [ ] **Step 6: Commit + push**

```bash
git add apps/web/src/routes/_authed/admin/importers.$id.upload.tsx
git commit -m "feat(web): capture edited rows from review grid in route state

handleReviewed now receives editedRows and stashes them in
WizardState.editedRows. Story #7 will read this + s.context +
s.parsed + s.matched to build the POST /api/uploads payload and
chunk into per-batch POSTs. Post-review hint reflects the
captured row count."
git push -u origin feature/6-inline-editing
```

---

## Self-review

Checking against PRD-002 §5.4 (Story 4b — inline editing portion):

| AC | Task |
|---|---|
| 1. Single-click enters edit mode | Task 2 (EditableCell `onClick`); tested |
| 2. Enter/Tab commits, Esc cancels | Task 2 (`onKeyDown` switch); tested for all three |
| 3. Validation re-runs for the edited cell only | Task 1 (`_commitCellEdit` patches incrementally); Task 3 test asserts summary updates |
| 4. Summary chip updates after every commit | Task 1 (counts in `useState`, updated via `setValidation`); Task 3 test |
| 5. "Show only errors" filter view updates in real time | Task 1 (derived from `errorRowIndices` which updates); Task 3 test |
| 6. 64 KB cap with toast | Task 2 (alert in editor); tested |
| 7. Tab advances to next cell in row | **Partial.** Task 2 calls `onCommit` on Tab — the browser's natural focus-next behaviour then moves the user to the next focusable element AFTER the input unmounts. This is the only focusable thing in the cell, so focus moves to the next cell's `<span>` (or button below). True "Tab moves to next cell's editor" is not implemented — would need imperative focus management. Acceptable trade-off for MVP; documented. |

**Out of scope (PRD §6 interactions, deliberately deferred):**
- Arrow-key navigation between cells in idle mode — listed as a UX nicety but not required for the inline-edit AC
- Animation/transition polish

**No placeholders.** All steps include actual code or commands.

**Type consistency:** `CellValidationResult` reused from Story #5. `EditableCellProps` is new. `StepReviewGridProps.onConfirmed` signature changed from `() => void` to `(editedRows: Record<string, string>[]) => void` — route updated in Task 4. `WizardState.editedRows` field added in Task 4.

---

## Execution

**Plan complete and saved to `docs/moai/plans/2026-05-26-story-6-inline-editing.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — same pattern that shipped Stories #2–#5.

**2. Inline Execution** — execute with `build`, batched.

**Which approach?**
