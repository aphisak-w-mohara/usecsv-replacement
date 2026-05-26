import { useMemo, useRef, useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ImporterColumn } from "../../lib/fuzzy-match";
import { validateCell, type CellValidationResult } from "../../lib/validators";

export type StepReviewGridProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  matched: Record<string, string>; // { machine_name: file_header }
  filterInvalidRows: boolean;
  disableIfAnyInvalid: boolean;
  onConfirmed: () => void;
  onBack: () => void;
};

type ValidationCache = Map<number, Map<string, CellValidationResult>>;

type RowWithMeta = {
  __rowIndex: number; // 1-based source row number, shown in the first column
  __hasError: boolean;
  __original: Record<string, string>;
};

// Virtualizer only kicks in above this threshold so that jsdom tests
// (which return all-zero getBoundingClientRect) can render small fixtures
// without the virtualizer deciding zero rows are visible.
const VIRTUALIZE_THRESHOLD = 50;

export function StepReviewGrid({
  fileHeaders: _fileHeaders,
  rows,
  importerColumns,
  matched,
  filterInvalidRows,
  disableIfAnyInvalid,
  onConfirmed,
  onBack,
}: StepReviewGridProps) {
  const { cache, errorCount, warningCount, errorRowIndices } = useMemo(() => {
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
  }, [rows, importerColumns, matched]);

  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  const tableRows: RowWithMeta[] = useMemo(() => {
    const result: RowWithMeta[] = [];
    rows.forEach((row, rowIdx) => {
      const hasError = errorRowIndices.has(rowIdx);
      if (showOnlyErrors && !hasError) return;
      result.push({
        __rowIndex: rowIdx + 1,
        __hasError: hasError,
        __original: row,
      });
    });
    return result;
  }, [rows, errorRowIndices, showOnlyErrors]);

  const mappedColumns = useMemo(
    () => importerColumns.filter((c) => matched[c.name]),
    [importerColumns, matched],
  );

  const columns: ColumnDef<RowWithMeta>[] = useMemo(() => {
    const cols: ColumnDef<RowWithMeta>[] = [
      {
        id: "__rowIndex",
        header: "#",
        size: 60,
        cell: (info) => <span className="text-slate-400">{info.row.original.__rowIndex}</span>,
      },
    ];
    for (const col of mappedColumns) {
      cols.push({
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
    return cols;
  }, [mappedColumns, matched, cache]);

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

  const blockedByInvalidGate = disableIfAnyInvalid && errorCount > 0;

  const tableRowModels = table.getRowModel().rows;
  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : null;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; submit</h2>
        <p className="text-sm text-slate-600">
          Each mapped cell has been validated against your importer schema. Errors highlighted in
          red — fix them later in Story #6.
        </p>
      </header>

      <div className="flex items-center gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <span data-testid="summary-rows">{rows.length.toLocaleString("en-US")} rows</span>
        <span>·</span>
        <span
          data-testid="summary-errors"
          className={errorCount > 0 ? "text-red-700" : "text-slate-600"}
        >
          {errorCount} error{errorCount === 1 ? "" : "s"}
        </span>
        <span>·</span>
        <span
          data-testid="summary-warnings"
          className={warningCount > 0 ? "text-yellow-700" : "text-slate-600"}
        >
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
                  const row = tableRowModels[virtualRow.index]!;
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
              : tableRowModels.map((row) => (
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
          No errors. Untick "Show only errors" to see all rows.
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
          onClick={onConfirmed}
          disabled={blockedByInvalidGate}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Next
        </button>
      </footer>
    </div>
  );
}
