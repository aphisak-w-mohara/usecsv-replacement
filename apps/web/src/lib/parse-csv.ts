import Papa from "papaparse";

export type CsvParseResult = {
  headers: string[];
  rows: Record<string, string>[];
  encoding: string;
};

/**
 * Parse a CSV or TSV file using PapaParse.
 *
 * - Assumes the first row is a header (PapaParse's `header: true`).
 * - Cell values are coerced to strings — never numbers — so downstream
 *   validators have a consistent input type.
 * - Encoding is best-effort: PapaParse exposes `meta.encoding` when it
 *   detects a BOM; otherwise we report "UTF-8" as the default.
 */
export function parseCsv(file: File, delimiter: "," | "\t"): Promise<CsvParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      delimiter,
      skipEmptyLines: true,
      transform: (value) => value, // keep raw strings; no number coercion
      complete: (results) => {
        if (results.errors.length > 0) {
          const fatal = results.errors.filter(
            (e) => e.type !== "FieldMismatch" && e.type !== "Quotes",
          );
          if (fatal.length > 0) {
            reject(new Error(fatal[0]?.message ?? "PapaParse failed"));
            return;
          }
        }
        const headers = results.meta.fields ?? [];
        const rows = results.data.map((row) => {
          const out: Record<string, string> = {};
          for (const h of headers) {
            const val = (row as Record<string, unknown>)[h];
            out[h] = val === undefined || val === null ? "" : String(val);
          }
          return out;
        });
        resolve({
          headers,
          rows,
          encoding:
            ((results.meta as unknown as Record<string, unknown>).encoding as string) || "UTF-8",
        });
      },
      error: (err) => reject(err),
    });
  });
}
