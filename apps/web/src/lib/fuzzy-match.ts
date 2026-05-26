import { matchSorter } from "match-sorter";

export type ImporterColumn = {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  example: string | null;
  must_be_matched: boolean;
  value_cannot_be_blank: boolean;
  validation_type:
    | "string"
    | "number"
    | "date"
    | "phone"
    | "email"
    | "regex"
    | "select"
    | "boolean";
  validation_format: string | null;
};

export type ColumnMapping = Record<string, string>;

export const IGNORE = "__ignore__" as const;

/**
 * Normalises a header string for fuzzy comparison:
 *   - lowercase
 *   - collapse runs of whitespace + underscore + dash into a single space
 *   - strip leading/trailing whitespace
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .trim();
}

/**
 * Suggests an initial column mapping. For each file header, finds the
 * best matching importer column by (1) normalised display_name exact
 * match, (2) normalised machine-name exact match, (3) match-sorter
 * fuzzy match against either field. Each importer column can be
 * claimed by at most one file header — when multiple compete, the
 * first (highest-ranked) file header wins; subsequent claimants get
 * IGNORE.
 *
 * Returned shape: `{ [fileHeader]: importerColumns.name | "__ignore__" }`.
 * Inverting this to the wire-format `matchedColumnsMap` is the
 * component's responsibility.
 */
export function suggestColumnMappings(
  fileHeaders: string[],
  importerColumns: ImporterColumn[],
): ColumnMapping {
  const mapping: ColumnMapping = {};
  const claimed = new Set<string>();

  const corpus = importerColumns.map((c) => ({
    column: c,
    keys: [c.display_name, c.name],
  }));

  for (const header of fileHeaders) {
    if (importerColumns.length === 0) {
      mapping[header] = IGNORE;
      continue;
    }

    const headerNorm = normalise(header);

    // Stage 1: exact normalised match
    let pick: ImporterColumn | null = null;
    for (const { column } of corpus) {
      if (claimed.has(column.name)) continue;
      if (normalise(column.display_name) === headerNorm || normalise(column.name) === headerNorm) {
        pick = column;
        break;
      }
    }

    // Stage 2: fuzzy match
    if (!pick) {
      const candidates = corpus.filter(({ column }) => !claimed.has(column.name));
      const ranked = matchSorter(candidates, header, {
        keys: ["keys.0", "keys.1"],
        threshold: matchSorter.rankings.CONTAINS,
      });
      if (ranked.length > 0 && ranked[0]) {
        pick = ranked[0].column;
      }
    }

    if (pick) {
      mapping[header] = pick.name;
      claimed.add(pick.name);
    } else {
      mapping[header] = IGNORE;
    }
  }

  return mapping;
}
