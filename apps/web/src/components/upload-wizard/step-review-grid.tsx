import { useRef, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ImporterColumn } from "../../lib/fuzzy-match";
import { validateCell, type CellValidationResult } from "../../lib/validators";
import { EditableCell } from "./editable-cell";

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
): {
  cache: ValidationCache;
  errorCount: number;
  warningCount: number;
  errorRowIndices: Set<number>;
} {
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
      cell: (info) => <span className="text-slate-400">{info.row.original.__rowIndex}</span>,
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
        return (
          <EditableCell
            value={value}
            validation={result}
            onCommit={(newValue) => _commitCellEdit(rowIdx, col.name, newValue)}
          />
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
        <span>{rows.length.toLocaleString("en-US")} rows</span>
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

      <div ref={parentRef} className="h-[480px] overflow-auto rounded-md border border-slate-200">
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
                        <td key={cell.id} style={{ width: cell.column.getSize() }} className="p-0">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })
              : table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} style={{ width: cell.column.getSize() }} className="p-0">
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
          {errorRowIndices.size} row{errorRowIndices.size === 1 ? "" : "s"} will be excluded due to
          errors.
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
