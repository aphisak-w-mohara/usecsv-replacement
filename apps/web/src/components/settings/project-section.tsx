import { useEffect, useState } from "react";

type Props = {
  /** The saved domain restriction, or null when unrestricted. */
  allowedEmailDomain: string | null;
  /** Count of existing members whose email domain doesn't match the saved value. */
  mismatchedMemberCount: number;
  loading?: boolean;
  /** True while a save/clear request is in flight. */
  saving: boolean;
  /** Inline error (e.g. the 400 "Enter a valid domain…") or a load/save error. */
  error?: string | null;
  /** Persist a new value; `null`/empty clears the restriction. */
  onSave: (domain: string | null) => void;
};

/**
 * Settings → Project section (PRD-004 Story 5). Owner-only. A single
 * "Restrict sign-in to Google Workspace domain" field with Save + Clear, plus a
 * warning when the restriction is set and existing members fall outside it.
 */
export function ProjectSection({
  allowedEmailDomain,
  mismatchedMemberCount,
  loading,
  saving,
  error,
  onSave,
}: Props) {
  const [value, setValue] = useState(allowedEmailDomain ?? "");

  // Re-sync the field when the saved value changes (after a save/clear reload).
  useEffect(() => {
    setValue(allowedEmailDomain ?? "");
  }, [allowedEmailDomain]);

  const trimmed = value.trim();
  const showWarning = allowedEmailDomain !== null && mismatchedMemberCount > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    onSave(trimmed.length === 0 ? null : trimmed);
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Project</h2>
        <p className="text-sm text-slate-500">
          Restrict who can sign in and be invited to this project.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showWarning && (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {mismatchedMemberCount} existing member{mismatchedMemberCount === 1 ? "" : "s"} have a
          different email domain. They keep access; only new sign-ins and invites are restricted.
        </div>
      )}

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Restrict sign-in to Google Workspace domain (optional)
          </span>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="mohara.co"
            disabled={loading || saving}
            aria-label="Allowed email domain"
            className="max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || saving}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={loading || saving || (allowedEmailDomain === null && trimmed.length === 0)}
            onClick={() => {
              setValue("");
              onSave(null);
            }}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      </form>
    </section>
  );
}
