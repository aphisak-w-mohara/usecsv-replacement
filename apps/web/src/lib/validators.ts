import type { ImporterColumn } from "./fuzzy-match";

export type CellValidationResult =
  | { ok: true }
  | { ok: false; severity: "error" | "warning"; message: string };

export function validateCell(
  _value: string,
  _column: ImporterColumn,
): CellValidationResult {
  throw new Error("not implemented");
}
