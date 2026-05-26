import type { CellValidationResult } from "../../lib/validators";

export const MAX_CELL_BYTES = 64 * 1024;

export type EditableCellProps = {
  value: string;
  validation: CellValidationResult | undefined;
  onCommit: (newValue: string) => void;
};

export function EditableCell(_props: EditableCellProps) {
  return null;
}
