import { useState } from "react";
import { parseFile, type ParseOutcome, type ParseSuccess } from "../../lib/parse-file";
import { cn } from "../../lib/cn";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { UploadIcon } from "../ui/icons";

export type StepUploadFileProps = {
  onParsed: (result: ParseSuccess) => void;
  onBack: () => void;
};

type State =
  | { phase: "empty" }
  | { phase: "parsing"; fileName: string }
  | { phase: "result"; outcome: ParseOutcome };

export function StepUploadFile({ onParsed, onBack }: StepUploadFileProps) {
  const [state, setState] = useState<State>({ phase: "empty" });
  const [dragOver, setDragOver] = useState(false);

  async function handleFileSelect(file: File) {
    setState({ phase: "parsing", fileName: file.name });
    const outcome = await parseFile(file);
    setState({ phase: "result", outcome });
  }

  function handleReset() {
    setState({ phase: "empty" });
  }

  function handleNext() {
    if (state.phase === "result" && state.outcome.ok) {
      onParsed(state.outcome);
    }
  }

  const canAdvance = state.phase === "result" && state.outcome.ok;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="text-lg font-semibold text-foreground">Upload file</h2>
        <p className="text-sm text-muted-foreground">
          CSV, TSV, XLSX, or XLS. Max 50,000 rows / 25&nbsp;MB. The file is parsed in your browser —
          nothing leaves until you submit.
        </p>
      </header>

      {state.phase === "empty" && (
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-sm transition-colors",
            dragOver
              ? "border-primary bg-accent text-accent-foreground"
              : "border-input bg-muted text-muted-foreground hover:bg-accent",
          )}
          aria-label="Upload file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileSelect(file);
          }}
        >
          <UploadIcon className="size-6 text-muted-foreground" />
          <span className="font-medium text-foreground">Click to browse or drag and drop</span>
          <span className="text-xs text-muted-foreground">.csv .tsv .xlsx .xls</span>
          <input
            type="file"
            accept=".csv,.tsv,.xlsx,.xls"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
        </label>
      )}

      {state.phase === "parsing" && (
        <div className="flex items-center justify-center gap-3 rounded-md border border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
          <Spinner label="Parsing your file" />
          <span>Parsing your file…</span>
        </div>
      )}

      {state.phase === "result" && !state.outcome.ok && (
        <Alert tone="danger" title="Could not parse file">
          {state.outcome.message}
        </Alert>
      )}

      {state.phase === "result" && state.outcome.ok && <ParsedPreview outcome={state.outcome} />}

      {state.phase === "result" && (
        <div>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            Upload a different file
          </Button>
        </div>
      )}

      <footer className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={handleNext} disabled={!canAdvance}>
          Next
        </Button>
      </footer>
    </div>
  );
}

function ParsedPreview({ outcome }: { outcome: ParseSuccess }) {
  const previewRows = outcome.rows.slice(0, 100);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted px-4 py-3 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          <div className="font-semibold text-foreground">File</div>
          <div className="break-words">{outcome.fileName}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Rows</div>
          <div>{outcome.rowCount.toLocaleString("en-US")} rows</div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Format</div>
          <div>
            {outcome.format.toUpperCase()}
            {outcome.sheetCount && outcome.sheetCount > 1
              ? ` (sheet "${outcome.sheetName}" of ${outcome.sheetCount})`
              : ""}
          </div>
        </div>
        <div>
          <div className="font-semibold text-foreground">Encoding</div>
          <div>{outcome.encoding}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="min-w-full text-xs">
          <thead className="bg-muted">
            <tr>
              {outcome.headers.map((h) => (
                <th
                  key={h}
                  className="border-b border-border px-3 py-2 text-left font-semibold text-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => (
              <tr key={idx} className="even:bg-muted/50">
                {outcome.headers.map((h) => (
                  <td key={h} className="border-b border-border px-3 py-1.5 text-muted-foreground">
                    {row[h] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {outcome.rowCount > previewRows.length && (
        <p className="text-xs text-muted-foreground">
          Showing first {previewRows.length} of {outcome.rowCount.toLocaleString("en-US")} rows.
        </p>
      )}
    </div>
  );
}
