import { useState } from "react";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Modal } from "../ui/modal";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";

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
const NAME_ERROR =
  "Name must match the required format: start with a lowercase letter, then only lowercase letters, numbers, and underscores.";

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
  const usesFormat = draft.validation_type === "select" || draft.validation_type === "regex";
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
      custom_error_message: draft.custom_error_message?.trim() ? draft.custom_error_message : null,
    };
    onSave(cleaned);
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title={mode === "add" ? "Add column" : "Edit column"}
      dismissable={!saving}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSave} loading={saving}>
            {mode === "add" ? "Add column" : "Save changes"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Machine name"
            required
            error={!nameValid && draft.name.length > 0 ? NAME_ERROR : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="text"
                value={draft.name}
                onChange={(e) => update("name", e.target.value)}
                disabled={mode === "edit"}
                placeholder="snake_case"
              />
            )}
          </Field>
          <Field label="Display name" required>
            {(p) => (
              <Input
                {...p}
                type="text"
                value={draft.display_name}
                onChange={(e) => update("display_name", e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field label="Description" optional>
          {(p) => (
            <Textarea
              {...p}
              value={draft.description ?? ""}
              onChange={(e) => update("description", e.target.value)}
              rows={2}
            />
          )}
        </Field>

        <Field label="Example" optional>
          {(p) => (
            <Input
              {...p}
              type="text"
              value={draft.example ?? ""}
              onChange={(e) => update("example", e.target.value)}
            />
          )}
        </Field>

        <fieldset className="grid grid-cols-1 gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-foreground">Validation</legend>
          <Field label="Validation type">
            {(p) => (
              <Select
                {...p}
                value={draft.validation_type}
                onChange={(e) => update("validation_type", e.target.value as ValidationType)}
              >
                {VALIDATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {usesFormat && (
            <Field
              label={
                draft.validation_type === "select" ? "Options (comma-separated)" : "Regex pattern"
              }
            >
              {(p) => (
                <Input
                  {...p}
                  type="text"
                  value={draft.validation_format ?? ""}
                  onChange={(e) => update("validation_format", e.target.value)}
                />
              )}
            </Field>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2 text-sm text-foreground">
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

        <Field label="Custom error message" optional>
          {(p) => (
            <Input
              {...p}
              type="text"
              value={draft.custom_error_message ?? ""}
              onChange={(e) => update("custom_error_message", e.target.value)}
            />
          )}
        </Field>

        {saveError && <Alert tone="danger">{saveError}</Alert>}
      </div>
    </Modal>
  );
}
