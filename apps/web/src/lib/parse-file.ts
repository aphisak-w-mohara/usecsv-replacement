import { extensionOf, MAX_ROW_COUNT, validateFile } from "./file-validate";
import { parseCsv } from "./parse-csv";
import { parseXlsx } from "./parse-xlsx";

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

export async function parseFile(file: File): Promise<ParseOutcome> {
  const validation = validateFile(file);
  if (!validation.ok) {
    return validation as ParseError;
  }

  const ext = extensionOf(file.name) as "csv" | "tsv" | "xlsx" | "xls";

  try {
    if (ext === "csv" || ext === "tsv") {
      const parsed = await parseCsv(file, ext === "tsv" ? "\t" : ",");
      return finalize(file, ext, {
        headers: parsed.headers,
        rows: parsed.rows,
        encoding: parsed.encoding,
      });
    }
    const parsed = await parseXlsx(file);
    return finalize(file, ext, {
      headers: parsed.headers,
      rows: parsed.rows,
      encoding: "UTF-8",
      sheetName: parsed.sheetName,
      sheetCount: parsed.sheetCount,
    });
  } catch (err) {
    return {
      ok: false,
      code: "PARSE_FAILED",
      message: err instanceof Error ? err.message : "Failed to parse the file.",
    };
  }
}

function finalize(
  file: File,
  format: "csv" | "tsv" | "xlsx" | "xls",
  parsed: {
    headers: string[];
    rows: ParsedRow[];
    encoding: string;
    sheetName?: string;
    sheetCount?: number;
  },
): ParseOutcome {
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      code: "EMPTY_FILE",
      message: "This file has no data rows. Add at least one row beneath the header.",
    };
  }
  if (parsed.rows.length > MAX_ROW_COUNT) {
    return {
      ok: false,
      code: "TOO_MANY_ROWS",
      message: `This file has ${parsed.rows.length.toLocaleString("en-US")} rows. The current limit is 50,000 — split it and run again.`,
    };
  }
  return {
    ok: true,
    headers: parsed.headers,
    rows: parsed.rows,
    fileName: file.name,
    fileSize: file.size,
    rowCount: parsed.rows.length,
    format,
    encoding: parsed.encoding,
    sheetName: parsed.sheetName,
    sheetCount: parsed.sheetCount,
  };
}
