import { useState } from "react";

export const VALIDATION_TYPES = [
  "string",
  "number",
  "email",
  "phone",
  "url",
  "date",
  "select",
  "regex",
] as const;
export type ValidationType = (typeof VALIDATION_TYPES)[number];

const NAME_RE = /^[a-z][a-z0-9_]*$/;

export type ColumnDraft = {
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: boolean;
  value_cannot_be_blank: boolean;
  validation_type: ValidationType;
  validation_format: string | null;
  custom_error_message: string | null;
};

export const EMPTY_DRAFT: ColumnDraft = {
  name: "",
  display_name: "",
  description: null,
  example: null,
  must_be_matched: true,
  value_cannot_be_blank: true,
  validation_type: "string",
  validation_format: null,
  custom_error_message: null,
};

type Props = {
  mode: "add" | "edit";
  initial: ColumnDraft;
  saving: boolean;
  saveError: string | null;
  onSave: (draft: ColumnDraft) => void;
  onCancel: () => void;
};

export function ColumnEditor({ mode, initial, saving, saveError, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<ColumnDraft>(initial);

  const nameValid = NAME_RE.test(draft.name);
  const displayValid = draft.display_name.trim().length > 0;
  const usesFormat =
    draft.validation_type === "select" || draft.validation_type === "regex";
  const canSave = !saving && nameValid && displayValid;

  function update<K extends keyof ColumnDraft>(key: K, value: ColumnDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleSubmit() {
    if (!canSave) return;
    const cleaned: ColumnDraft = {
      ...draft,
      description: draft.description?.trim() ? draft.description : null,
      example: draft.example?.trim() ? draft.example : null,
      validation_format:
        usesFormat && draft.validation_format?.trim() ? draft.validation_format : null,
      custom_error_message: draft.custom_error_message?.trim()
        ? draft.custom_error_message
        : null,
    };
    onSave(cleaned);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="column-editor-title"
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-auto rounded-md bg-white p-6 shadow-lg">
        <h3 id="column-editor-title" className="text-base font-semibold text-slate-900">
          {mode === "add" ? "Add column" : "Edit column"}
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Machine name *</span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              disabled={mode === "edit"}
              placeholder="snake_case"
              className="rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-100"
            />
            {!nameValid && draft.name.length > 0 && (
              <span className="text-xs text-red-700">
                Must match <code>^[a-z][a-z0-9_]*$</code>
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Display name *</span>
            <input
              type="text"
              value={draft.display_name}
              onChange={(e) => update("display_name", e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Description</span>
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => update("description", e.target.value)}
            rows={2}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Example</span>
          <input
            type="text"
            value={draft.example ?? ""}
            onChange={(e) => update("example", e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Validation type</span>
            <select
              value={draft.validation_type}
              onChange={(e) => update("validation_type", e.target.value as ValidationType)}
              className="rounded-md border border-slate-300 px-3 py-2"
            >
              {VALIDATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {usesFormat && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">
                {draft.validation_type === "select"
                  ? "Options (comma-separated)"
                  : "Regex pattern"}
              </span>
              <input
                type="text"
                value={draft.validation_format ?? ""}
                onChange={(e) => update("validation_format", e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          )}
        </div>

        <fieldset className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.must_be_matched}
              onChange={(e) => update("must_be_matched", e.target.checked)}
            />
            Must be matched
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.value_cannot_be_blank}
              onChange={(e) => update("value_cannot_be_blank", e.target.checked)}
            />
            Value cannot be blank
          </label>
        </fieldset>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Custom error message</span>
          <input
            type="text"
            value={draft.custom_error_message ?? ""}
            onChange={(e) => update("custom_error_message", e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        {saveError && (
          <p role="alert" className="text-sm text-red-700">
            {saveError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSave}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {mode === "add" ? "Add column" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
