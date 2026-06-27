import { useEffect, useRef, useState } from "react";

export type ImporterListItem = {
  id: string;
  name: string;
  column_count: number;
  env_count: number;
  archived: boolean;
  updated_at: number;
};

type Props = {
  importers: ImporterListItem[];
  showArchived: boolean;
  creating: boolean;
  loading?: boolean;
  error?: string | null;
  onToggleArchived: (next: boolean) => void;
  onCreate: (name: string) => void;
  /** Open an importer's detail/settings page. */
  onOpen?: (id: string) => void;
  /** Start the upload wizard for an importer. */
  onUpload?: (id: string) => void;
};

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatUpdated(updatedAtSeconds: number): string {
  return new Date(updatedAtSeconds * 1000).toLocaleDateString();
}

export function ImporterListView({
  importers,
  showArchived,
  creating,
  loading,
  error,
  onToggleArchived,
  onCreate,
  onOpen,
  onUpload,
}: Props) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const canCreate = trimmed.length > 0 && !creating;

  const wasCreating = useRef(false);
  useEffect(() => {
    if (wasCreating.current && !creating && !error) {
      setName("");
    }
    wasCreating.current = creating;
  }, [creating, error]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    onCreate(trimmed);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Importers</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onToggleArchived(e.target.checked)}
          />
          Show archived
        </label>
      </header>

      <form className="flex items-end gap-3" onSubmit={handleSubmit}>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-sm font-medium">New importer name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Properties"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={!canCreate}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create importer"}
        </button>
      </form>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading importers…</p>
      ) : importers.length === 0 ? (
        <p className="text-sm text-slate-500">
          No importers yet — create your first importer above.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200">
          {importers.map((importer) => (
            <li key={importer.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-slate-900">
                  <button
                    type="button"
                    onClick={() => onOpen?.(importer.id)}
                    className="text-left hover:underline"
                  >
                    {importer.name}
                  </button>
                  {importer.archived && (
                    <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      Archived
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-500">
                  {pluralize(importer.column_count, "column")} ·{" "}
                  {pluralize(importer.env_count, "environment")}
                </span>
                <span className="text-xs text-slate-400">
                  Updated {formatUpdated(importer.updated_at)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!importer.archived && (
                  <button
                    type="button"
                    onClick={() => onUpload?.(importer.id)}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Upload
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpen?.(importer.id)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Settings
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
