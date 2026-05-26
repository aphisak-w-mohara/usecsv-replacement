/**
 * The exact shape of the JSON body POSTed to a customer's webhook URL.
 * Empirically pinned to captured-payloads/2026-05-26-usecsv-live-webhook.json.
 *
 * INVARIANTS:
 * - uploadId is an integer (Laravel validates as int)
 * - importerId is a UUID string (importer_environments.key)
 * - batch.index is 1-based; final batch satisfies batch.index === batch.count
 * - matchedColumnsMap direction is { machine_name: file_header } — NOT the reverse
 * - rows[i] keys are importer_columns.name values (machine names)
 * - rows[i].row is the 1-based source-file row number
 * - user and metadata are objects OR null — never undefined, never omitted
 */
export type WebhookPayload = {
  uploadId: number;
  importerId: string;
  fileName: string;
  matchedColumnsMap: Record<string, string>;
  uploadedFileHeaders: string[];
  batch: {
    index: number;
    count: number;
    totalRows: number;
  };
  user: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  rows: Array<Record<string, unknown> & { row: number }>;
};

export type WebhookErrorsResponse = {
  errors?: Array<{ row: number; msg: string }>;
};
