import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Field } from "../ui/field";
import { InboxIcon, PlusIcon, SettingsIcon, UploadIcon } from "../ui/icons";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

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
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Importers</h1>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => onToggleArchived(e.target.checked)}
            className="size-4 rounded border-input text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          Show archived
        </label>
      </header>

      <Card>
        <form
          className="flex flex-col items-stretch gap-3 p-5 sm:flex-row sm:items-end"
          onSubmit={handleSubmit}
        >
          <Field label="New importer name" className="flex-1">
            {(p) => (
              <Input
                {...p}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Properties"
              />
            )}
          </Field>
          <Button
            type="submit"
            disabled={!canCreate}
            loading={creating}
            icon={<PlusIcon className="size-4" />}
          >
            {creating ? "Creating…" : "Create importer"}
          </Button>
        </form>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner decorative />
          <span>Loading importers…</span>
        </div>
      ) : importers.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="size-6" />}
          title="No importers yet"
          description="Create your first importer above to start ingesting CSV data."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3">
                    Name
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Details
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Last modified</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {importers.map((importer) => (
                  <tr key={importer.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpen?.(importer.id)}
                          className="text-left font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {importer.name}
                        </button>
                        {importer.archived && <Badge tone="warning">Archived</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral">{pluralize(importer.column_count, "column")}</Badge>
                        <Badge tone="neutral">{pluralize(importer.env_count, "environment")}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                      Updated {formatUpdated(importer.updated_at)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex shrink-0 items-center justify-end gap-2">
                        {!importer.archived && (
                          <Button
                            size="sm"
                            onClick={() => onUpload?.(importer.id)}
                            icon={<UploadIcon className="size-4" />}
                          >
                            Upload
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onOpen?.(importer.id)}
                          icon={<SettingsIcon className="size-4" />}
                        >
                          Settings
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
