import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { ConfirmDialog } from "../ui/confirm-dialog";
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
    return <p className="text-sm text-red-700">{loadError}</p>;
  }
  if (columns === null) {
    return <p className="text-sm text-slate-500">Loading columns…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="note"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        Column changes affect <strong>all environments including production</strong>.
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setSaveError(null);
            setEditor({ mode: "add" });
          }}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          + Add column
        </button>
      </div>

      {columns.length === 0 ? (
        <p className="text-sm text-slate-500">No columns yet. Click "+ Add column" to start.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="py-2 pr-4 font-medium text-slate-700">Order</th>
              <th className="py-2 pr-4 font-medium text-slate-700">Name</th>
              <th className="py-2 pr-4 font-medium text-slate-700">Display</th>
              <th className="py-2 pr-4 font-medium text-slate-700">Type</th>
              <th className="py-2 pr-4 font-medium text-slate-700">Required</th>
              <th className="py-2 pr-4 font-medium text-slate-700" />
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => (
              <tr
                key={col.id}
                className="border-b border-slate-100"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", col.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData("text/plain");
                  if (draggedId) handleDrop(draggedId, col.id);
                }}
              >
                <td className="py-2 pr-4 text-slate-500">
                  <span className="mr-2 cursor-grab select-none" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${col.name} up`}
                    disabled={idx === 0 || saving}
                    onClick={() => moveColumn(col.id, -1)}
                    className="px-1 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${col.name} down`}
                    disabled={idx === columns.length - 1 || saving}
                    onClick={() => moveColumn(col.id, 1)}
                    className="px-1 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </td>
                <td className="py-2 pr-4 font-mono text-xs text-slate-700">{col.name}</td>
                <td className="py-2 pr-4 text-slate-900">{col.display_name}</td>
                <td className="py-2 pr-4 text-slate-700">{col.validation_type}</td>
                <td className="py-2 pr-4 text-slate-700">{col.must_be_matched ? "Yes" : "No"}</td>
                <td className="py-2 pr-4 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setSaveError(null);
                      setEditor({ mode: "edit", column: col });
                    }}
                    className="mr-2 text-sm text-slate-700 underline"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(col.id)}
                    className="text-sm text-red-700 underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
