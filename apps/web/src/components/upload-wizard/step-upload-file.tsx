import { useState } from "react";
import { parseFile, type ParseOutcome, type ParseSuccess } from "../../lib/parse-file";

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
        <h2 className="text-lg font-semibold text-slate-900">Upload file</h2>
        <p className="text-sm text-slate-600">
          CSV, TSV, XLSX, or XLS. Max 50,000 rows / 25&nbsp;MB. The file is parsed in your browser —
          nothing leaves until you submit.
        </p>
      </header>

      {state.phase === "empty" && (
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-sm text-slate-600 hover:bg-slate-100"
          aria-label="Upload file"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) handleFileSelect(file);
          }}
        >
          <span className="font-medium text-slate-700">Click to browse or drag and drop</span>
          <span className="text-xs text-slate-500">.csv .tsv .xlsx .xls</span>
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
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
          Parsing your file…
        </div>
      )}

      {state.phase === "result" && !state.outcome.ok && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.outcome.message}
        </div>
      )}

      {state.phase === "result" && state.outcome.ok && <ParsedPreview outcome={state.outcome} />}

      {state.phase === "result" && (
        <div>
          <button
            type="button"
            onClick={handleReset}
            className="text-sm font-medium text-slate-700 underline"
          >
            Upload a different file
          </button>
        </div>
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
          disabled={!canAdvance}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Next
        </button>
      </footer>
    </div>
  );
}

function ParsedPreview({ outcome }: { outcome: ParseSuccess }) {
  const previewRows = outcome.rows.slice(0, 100);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 md:grid-cols-4">
        <div>
          <div className="font-semibold text-slate-700">File</div>
          <div>{outcome.fileName}</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Rows</div>
          <div>{outcome.rowCount.toLocaleString("en-US")} rows</div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Format</div>
          <div>
            {outcome.format.toUpperCase()}
            {outcome.sheetCount && outcome.sheetCount > 1
              ? ` (sheet "${outcome.sheetName}" of ${outcome.sheetCount})`
              : ""}
          </div>
        </div>
        <div>
          <div className="font-semibold text-slate-700">Encoding</div>
          <div>{outcome.encoding}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-100">
            <tr>
              {outcome.headers.map((h) => (
                <th
                  key={h}
                  className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => (
              <tr key={idx} className="even:bg-slate-50">
                {outcome.headers.map((h) => (
                  <td key={h} className="border-b border-slate-100 px-3 py-1.5 text-slate-700">
                    {row[h] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {outcome.rowCount > previewRows.length && (
        <p className="text-xs text-slate-500">
          Showing first {previewRows.length} of {outcome.rowCount.toLocaleString("en-US")} rows.
        </p>
      )}
    </div>
  );
}
