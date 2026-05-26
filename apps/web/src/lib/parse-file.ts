export type ParsedRow = Record<string, string>;

export type ParseSuccess = {
  ok: true;
  headers: string[];
  rows: ParsedRow[];
  fileName: string;
  fileSize: number;
  rowCount: number;
  format: "csv" | "tsv" | "xlsx" | "xls";
  encoding: string;
  sheetName?: string;
  sheetCount?: number;
};

export type ParseError = {
  ok: false;
  code:
    | "EXTENSION_NOT_ALLOWED"
    | "FILE_TOO_LARGE"
    | "TOO_MANY_ROWS"
    | "EMPTY_FILE"
    | "PARSE_FAILED";
  message: string;
};

export type ParseOutcome = ParseSuccess | ParseError;

export async function parseFile(_file: File): Promise<ParseOutcome> {
  throw new Error("not implemented");
}
