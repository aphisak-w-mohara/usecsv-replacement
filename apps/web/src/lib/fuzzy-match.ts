export type ImporterColumn = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: boolean;
  value_cannot_be_blank: boolean;
  validation_type: "string" | "number" | "date" | "phone" | "email" | "regex" | "select" | "boolean";
  validation_format: string | null;
};

export type ColumnMapping = Record<string, string>;

export const IGNORE = "__ignore__" as const;

export function suggestColumnMappings(
  _fileHeaders: string[],
  _importerColumns: ImporterColumn[],
): ColumnMapping {
  throw new Error("not implemented");
}
