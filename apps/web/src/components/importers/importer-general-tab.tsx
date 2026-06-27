import { useState } from "react";

export type GeneralTabImporter = {
  id: string;
  name: string;
  archived: boolean;
};

type Props = {
  importer: GeneralTabImporter;
  saving: boolean;
  saveError: string | null;
  onSave: (newName: string) => void;
  onArchive: () => void;
  onUnarchive: () => void;
};

export function ImporterGeneralTab({
  importer,
  saving,
  saveError,
  onSave,
  onArchive,
  onUnarchive,
}: Props) {
  const [name, setName] = useState(importer.name);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const trimmed = name.trim();
  const canSave = !saving && trimmed.length > 0 && trimmed !== importer.name;

  function handleSave() {
    if (!canSave) return;
    onSave(trimmed);
  }

  function handleArchiveConfirm() {
    setConfirmingArchive(false);
    onArchive();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label htmlFor="importer-name" className="text-sm font-medium text-slate-700">
          Importer name
        </label>
        <div className="flex gap-2">
          <input
            id="importer-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            maxLength={200}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-red-700">
            {saveError}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-slate-200 pt-6">
        <h2 className="text-sm font-medium text-slate-700">Archive</h2>
        <p className="text-xs text-slate-500">
          Archiving hides this importer from the list and prevents new uploads against it.
          Historical uploads remain viewable. You can unarchive later from the Show-archived view.
        </p>
        {importer.archived ? (
          <button
            type="button"
            onClick={onUnarchive}
            disabled={saving}
            className="self-start rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            Unarchive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingArchive(true)}
            disabled={saving}
            className="self-start rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-50"
          >
            Archive
          </button>
        )}
      </section>

      {confirmingArchive && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-confirm-title"
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30"
        >
          <div className="flex flex-col gap-4 rounded-md bg-white p-6 shadow-lg">
            <h3 id="archive-confirm-title" className="text-base font-semibold text-slate-900">
              Archive {importer.name}?
            </h3>
            <p className="max-w-sm text-sm text-slate-600">
              Archiving hides this importer from the list and prevents new uploads against it.
              Historical uploads remain viewable.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingArchive(false)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleArchiveConfirm}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white"
              >
                Archive importer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
