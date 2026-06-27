import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { EmptyState } from "../ui/empty-state";
import { ArrowDownIcon, ArrowUpIcon, GripIcon, PlusIcon, TableIcon, TrashIcon } from "../ui/icons";
import { Spinner } from "../ui/spinner";
import { ColumnEditor, EMPTY_DRAFT, type ColumnDraft, type ValidationType } from "./column-editor";

type ColumnRow = ColumnDraft & {
  id: string;
  position: number;
};

type Props = {
  importerId: string;
};

export function ColumnsTab({ importerId }: Props) {
  const [columns, setColumns] = useState<ColumnRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    { mode: "add" } | { mode: "edit"; column: ColumnRow } | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setColumns(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].columns.$get({
          param: { importer_id: importerId },
        });
        if (!res.ok) throw new Error(`Failed to load columns: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setColumns(data.columns as ColumnRow[]);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [importerId]);

  async function handleCreate(draft: ColumnDraft) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.api.importers[":importer_id"].columns.$post({
        param: { importer_id: importerId },
        json: draft,
      });
      if (res.status === 409) {
        const body = (await res.json()) as { error?: string };
        setSaveError(body.error ?? "A column with this name already exists");
        return;
      }
      if (!res.ok) throw new Error(`Failed to create column: ${res.status}`);
      const data = await res.json();
      setColumns((prev) => [...(prev ?? []), data.column as ColumnRow]);
      setEditor(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(column: ColumnRow, draft: ColumnDraft) {
    setSaving(true);
    setSaveError(null);
    try {
      // name is immutable through the editor (disabled), so we only PATCH the rest.
      const { name: _omit, ...patch } = draft;
      const res = await api.api.importers[":importer_id"].columns[":column_id"].$patch({
        param: { importer_id: importerId, column_id: column.id },
        json: patch,
      });
      if (res.status === 409) {
        const body = (await res.json()) as { error?: string };
        setSaveError(body.error ?? "A column with this name already exists");
        return;
      }
      if (!res.ok) throw new Error(`Failed to update column: ${res.status}`);
      const data = await res.json();
      setColumns((prev) =>
        (prev ?? []).map((c) => (c.id === column.id ? (data.column as ColumnRow) : c)),
      );
      setEditor(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function applyReorder(orderedIds: string[]) {
    // Guard against concurrent reorders: ▲/▼ buttons are wired to disable on
    // `saving=true`, but a rapid double-click could still queue a second call
    // before this one's optimistic update lands. Early-return if one is in flight.
    if (saving) return;

    const prev = columns ?? [];
    // Optimistic local update.
    const byId = new Map(prev.map((c) => [c.id, c]));
    const reordered = orderedIds
      .map((id, i) => {
        const c = byId.get(id);
        return c ? { ...c, position: i + 1 } : null;
      })
      .filter((c): c is ColumnRow => c !== null);
    setColumns(reordered);
    setSaving(true);

    try {
      const res = await api.api.importers[":importer_id"].columns.order.$put({
        param: { importer_id: importerId },
        json: { ordered_ids: orderedIds },
      });
      if (!res.ok) {
        throw new Error(`Failed to reorder columns: ${res.status}`);
      }
      const data = await res.json();
      setColumns(data.columns as ColumnRow[]);
    } catch (err) {
      console.error("Reorder failed, reverting:", err);
      setColumns(prev);
    } finally {
      setSaving(false);
    }
  }

  function moveColumn(columnId: string, direction: -1 | 1) {
    if (saving) return;
    const cols = columns ?? [];
    const idx = cols.findIndex((c) => c.id === columnId);
    if (idx === -1) return;
    const target = idx + direction;
    if (target < 0 || target >= cols.length) return;
    const next = [...cols];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    void applyReorder(next.map((c) => c.id));
  }

  function handleDrop(draggedId: string, droppedOnId: string) {
    if (saving) return;
    if (draggedId === droppedOnId) return;
    const cols = columns ?? [];
    const from = cols.findIndex((c) => c.id === draggedId);
    const to = cols.findIndex((c) => c.id === droppedOnId);
    if (from === -1 || to === -1) return;
    const next = [...cols];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    void applyReorder(next.map((c) => c.id));
  }

  async function handleDelete(columnId: string) {
    setSaving(true);
    setDeleteError(null);
    try {
      const res = await api.api.importers[":importer_id"].columns[":column_id"].$delete({
        param: { importer_id: importerId, column_id: columnId },
      });
      if (!res.ok) {
        throw new Error(`Failed to delete column: ${res.status}`);
      }
      setColumns((prev) => (prev ?? []).filter((c) => c.id !== columnId));
      setPendingDeleteId(null);
    } catch (err) {
      console.error(err);
      setDeleteError(err instanceof Error ? err.message : "Failed to delete column");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return <Alert tone="danger">{loadError}</Alert>;
  }
  if (columns === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Loading columns…
      </div>
    );
  }

  const addColumnButton = (
    <Button
      icon={<PlusIcon className="size-4" />}
      onClick={() => {
        setSaveError(null);
        setEditor({ mode: "add" });
      }}
    >
      Add column
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">
        Column changes affect <strong>all environments including production</strong>.
      </Alert>

      {columns.length === 0 ? (
        <EmptyState
          icon={<TableIcon className="size-6" />}
          title="No columns yet"
          description="Add your first column to define the shape of the CSVs this importer accepts."
          action={addColumnButton}
        />
      ) : (
        <>
          <div className="flex justify-end">{addColumnButton}</div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Order</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Name</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Display</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Type</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground">Required</th>
                  <th className="py-2 pr-4 font-medium text-muted-foreground" />
                </tr>
              </thead>
              <tbody>
                {columns.map((col, idx) => {
                  const isDragging = draggingId === col.id;
                  const isDropTarget = dropTargetId === col.id && draggingId !== col.id;
                  return (
                    <tr
                      key={col.id}
                      className={cn(
                        "border-b border-border transition-opacity",
                        isDragging && "opacity-50",
                        isDropTarget && "ring-2 ring-inset ring-ring",
                      )}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", col.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggingId(col.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropTargetId(col.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTargetId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const draggedId = e.dataTransfer.getData("text/plain");
                        setDraggingId(null);
                        setDropTargetId(null);
                        if (draggedId) handleDrop(draggedId, col.id);
                      }}
                    >
                      <td className="py-2 pr-4 text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <GripIcon
                            className="size-4 cursor-grab text-muted-foreground"
                            aria-hidden="true"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Move ${col.name} up`}
                            disabled={idx === 0 || saving}
                            onClick={() => moveColumn(col.id, -1)}
                            icon={<ArrowUpIcon className="size-4" />}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Move ${col.name} down`}
                            disabled={idx === columns.length - 1 || saving}
                            onClick={() => moveColumn(col.id, 1)}
                            icon={<ArrowDownIcon className="size-4" />}
                          />
                        </div>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-foreground">{col.name}</td>
                      <td className="py-2 pr-4 font-medium text-foreground">{col.display_name}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{col.validation_type}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {col.must_be_matched ? "Yes" : "No"}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSaveError(null);
                              setEditor({ mode: "edit", column: col });
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-danger hover:text-danger"
                            aria-label={`Remove ${col.name}`}
                            onClick={() => setPendingDeleteId(col.id)}
                            icon={<TrashIcon className="size-4" />}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editor && (
        <ColumnEditor
          mode={editor.mode}
          initial={
            editor.mode === "edit"
              ? {
                  name: editor.column.name,
                  display_name: editor.column.display_name,
                  description: editor.column.description,
                  example: editor.column.example,
                  must_be_matched: editor.column.must_be_matched,
                  value_cannot_be_blank: editor.column.value_cannot_be_blank,
                  validation_type: editor.column.validation_type as ValidationType,
                  validation_format: editor.column.validation_format,
                  custom_error_message: editor.column.custom_error_message,
                }
              : EMPTY_DRAFT
          }
          saving={saving}
          saveError={saveError}
          onSave={(draft) => {
            if (editor.mode === "add") void handleCreate(draft);
            else void handleUpdate(editor.column, draft);
          }}
          onCancel={() => setEditor(null)}
        />
      )}

      {pendingDeleteId && (
        <ConfirmDialog
          title="Remove this column?"
          body="Historical uploads keep their original column snapshot, but new uploads will no longer include this column."
          confirmLabel="Remove column"
          danger
          busy={saving}
          error={deleteError}
          onCancel={() => {
            setPendingDeleteId(null);
            setDeleteError(null);
          }}
          onConfirm={() => void handleDelete(pendingDeleteId)}
        />
      )}
    </div>
  );
}
