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
  const committedRef = useRef(false);

  useEffect(() => {
    if (editing) {
      committedRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function tryCommit() {
    if (committedRef.current) return; // already committed once this edit session
    const byteLen = new TextEncoder().encode(draft).byteLength;
    if (byteLen > MAX_CELL_BYTES) {
      setTooLarge(true);
      return;
    }
    committedRef.current = true;
    setTooLarge(false);
    onCommit(draft);
    setEditing(false);
  }

  function cancel() {
    committedRef.current = true;
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
          className="block w-full rounded-sm border border-primary bg-card px-2 py-0.5 text-foreground outline-2 outline-offset-0 outline-ring"
        />
        {tooLarge && (
          <span
            role="alert"
            className="absolute left-0 top-full z-10 mt-0.5 rounded border border-danger/30 bg-danger-subtle px-2 py-0.5 text-xs text-danger-subtle-foreground"
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
          ? "block cursor-pointer bg-danger-subtle px-2 text-danger-subtle-foreground hover:opacity-90"
          : isWarn
            ? "block cursor-pointer bg-warning-subtle px-2 text-warning-subtle-foreground hover:opacity-90"
            : "block cursor-pointer px-2 hover:bg-muted"
      }
    >
      {isError ? "⚠ " : ""}
      {value}
    </span>
  );
}
