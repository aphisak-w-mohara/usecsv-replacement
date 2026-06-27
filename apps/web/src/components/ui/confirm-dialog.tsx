import { useEffect } from "react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive (red). */
  danger?: boolean;
  /** Disable both buttons while an async action is in flight. */
  busy?: boolean;
  /** Inline error to surface inside the dialog (e.g. a failed delete). */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Shared confirmation modal. Used for every destructive/irreversible action
 * (archive, delete column, disable signing, revoke invite). Supports
 * Escape-to-cancel and an in-flight `busy` state so a slow confirm can't be
 * double-fired or dismissed mid-request.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-md bg-white p-6 shadow-lg">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {body && <div className="text-sm text-slate-600">{body}</div>}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              danger
                ? "rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                : "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
