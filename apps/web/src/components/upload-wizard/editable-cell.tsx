import { useEffect, useRef, useState } from "react";
import type { CellValidationResult } from "../../lib/validators";

export const MAX_CELL_BYTES = 64 * 1024; // 64 KB

export type EditableCellProps = {
  value: string;
  validation: CellValidationResult | undefined;
  onCommit: (newValue: string) => void;
};

export function EditableCell({ value, validation, onCommit }: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [tooLarge, setTooLarge] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function tryCommit() {
    const byteLen = new TextEncoder().encode(draft).byteLength;
    if (byteLen > MAX_CELL_BYTES) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    onCommit(draft);
    setEditing(false);
  }

  function cancel() {
    setDraft(value);
    setTooLarge(false);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="relative block">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (tooLarge) setTooLarge(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              tryCommit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={tryCommit}
          className="block w-full bg-white px-2 py-0.5 outline outline-2 outline-blue-500"
        />
        {tooLarge && (
          <span
            role="alert"
            className="absolute left-0 top-full z-10 mt-0.5 rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700"
          >
            Cell value too large (over 64 KB)
          </span>
        )}
      </span>
    );
  }

  const isError = validation && !validation.ok && validation.severity === "error";
  const isWarn = validation && !validation.ok && validation.severity === "warning";

  return (
    <span
      onClick={() => setEditing(true)}
      title={validation && !validation.ok ? validation.message : undefined}
      className={
        isError
          ? "block cursor-pointer bg-red-50 px-2 text-red-900 hover:bg-red-100"
          : isWarn
            ? "block cursor-pointer bg-yellow-50 px-2 text-yellow-900 hover:bg-yellow-100"
            : "block cursor-pointer px-2 hover:bg-slate-100"
      }
    >
      {isError ? "⚠ " : ""}
      {value}
    </span>
  );
}
