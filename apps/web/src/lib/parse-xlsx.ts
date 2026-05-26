import * as XLSX from "xlsx";

export type XlsxParseResult = {
  headers: string[];
  rows: Record<string, string>[];
  sheetName: string;
  sheetCount: number;
};

/**
 * Parse an XLSX/XLS file using SheetJS.
 *
 * - Uses the FIRST sheet only (multi-sheet workbooks are flagged via `sheetCount`).
 * - Treats the first row as headers.
 * - Coerces every cell to a string for downstream validator consistency.
 *   Formulas are evaluated and the result is what gets returned; #N/A and
 *   #REF! errors come through as their string representation.
 */
export async function parseXlsx(file: File): Promise<XlsxParseResult> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetCount = workbook.SheetNames.length;
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Workbook has no sheets");
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`);
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  if (matrix.length === 0) {
    return { headers: [], rows: [], sheetName, sheetCount };
  }

  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? ""));
  const rows = matrix.slice(1).map((rawRow) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      const cell = (rawRow as unknown[])[i];
      row[h] = cell === undefined || cell === null ? "" : String(cell);
    });
    return row;
  });

  return { headers, rows, sheetName, sheetCount };
}
