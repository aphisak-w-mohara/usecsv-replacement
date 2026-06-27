import { useMemo, useState } from "react";
import {
  IGNORE,
  suggestColumnMappings,
  type ColumnMapping,
  type ImporterColumn,
} from "../../lib/fuzzy-match";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Select } from "../ui/select";

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
  const matchedColumnNames = new Set(Object.values(mapping).filter((v) => v !== IGNORE));
  const missingRequired = requiredColumns.filter((c) => !matchedColumnNames.has(c.name));
  const allRequiredMatched = missingRequired.length === 0;
  const ignoredCount = Object.values(mapping).filter((v) => v === IGNORE).length;
  const matchedRequiredCount = requiredColumns.length - missingRequired.length;

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
        <h2 className="text-lg font-semibold text-foreground">Match columns</h2>
        <p className="text-sm text-muted-foreground">
          Confirm or adjust each column mapping. The wizard pre-selected the closest match for each
          file header — required columns must be mapped to continue.
        </p>
      </header>

      <Alert
        tone={allRequiredMatched ? "success" : "danger"}
        title={`${matchedRequiredCount} of ${requiredColumns.length} required matched`}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{ignoredCount} ignored</span>
          {!allRequiredMatched && (
            <span>· Missing: {missingRequired.map((c) => c.display_name).join(", ")}</span>
          )}
        </div>
      </Alert>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-xs">
          <thead className="bg-muted">
            <tr>
              {fileHeaders.map((header) => (
                <th
                  key={header}
                  className="border-b border-border px-3 py-2 text-left font-semibold text-foreground"
                >
                  <div className="flex flex-col gap-1.5">
                    <span>{header}</span>
                    <Select
                      aria-label={`Map column ${header}`}
                      value={mapping[header] ?? IGNORE}
                      onChange={(e) => handleChange(header, e.target.value)}
                      className="h-8 text-xs font-normal"
                    >
                      <option value={IGNORE}>Ignore this column</option>
                      {importerColumns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.display_name}
                          {c.must_be_matched ? " *" : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => (
              <tr key={idx} className="even:bg-muted/50">
                {fileHeaders.map((header) => (
                  <td
                    key={header}
                    className="border-b border-border px-3 py-1.5 text-muted-foreground"
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
        <p className="text-xs text-muted-foreground">
          Showing first {previewRows.length} of {rows.length.toLocaleString("en-US")} rows.
        </p>
      )}

      <footer className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleNext} disabled={!allRequiredMatched}>
          Next
        </Button>
      </footer>
    </div>
  );
}
