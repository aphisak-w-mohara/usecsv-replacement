export type BuiltBatch = {
  index: number; // 1-based
  rows: Array<Record<string, string | number>>;
};

export type BuiltBatches = {
  total_rows: number;
  batch_count: number;
  batches: BuiltBatch[];
};

/**
 * Transform the wizard's edited rows (keyed by ORIGINAL FILE HEADER) into the
 * webhook row shape (keyed by IMPORTER MACHINE NAME) and chunk them into batches.
 *
 * `matched` is { machine_name: file_header } — the canonical wizard direction,
 * matching captured-payloads/2026-05-26-usecsv-live-webhook.json.matchedColumnsMap.
 *
 * Each output row gets a 1-based `row` number that is the row's position in the
 * WHOLE file (continuous across batches), echoed back by Laravel in errors.
 */
export function buildBatches(
  editedRows: Record<string, string>[],
  matched: Record<string, string>,
  batchSize: number,
): BuiltBatches {
  const machineNames = Object.keys(matched);

  const mapped: Array<Record<string, string | number>> = editedRows.map((srcRow, i) => {
    const out: Record<string, string | number> = { row: i + 1 };
    for (const machine of machineNames) {
      const fileHeader = matched[machine]!;
      out[machine] = srcRow[fileHeader] ?? "";
    }
    return out;
  });

  const batches: BuiltBatch[] = [];
  for (let start = 0; start < mapped.length; start += batchSize) {
    batches.push({
      index: batches.length + 1,
      rows: mapped.slice(start, start + batchSize),
    });
  }

  return {
    total_rows: mapped.length,
    batch_count: batches.length,
    batches,
  };
}
