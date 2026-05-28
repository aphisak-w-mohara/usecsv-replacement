import type { WebhookPayload } from "@evo-csv/shared";

export type BuildWebhookPayloadInput = {
  numericId: number;
  importerKey: string;
  fileName: string;
  matchedColumnsMap: Record<string, string>;
  uploadedFileHeaders: string[];
  batchIndex: number;
  batchCount: number;
  totalRows: number;
  user: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  rows: WebhookPayload["rows"];
};

/**
 * Assemble the canonical webhook body. Key order here mirrors the captured
 * usecsv fixture for readability, but receivers must not depend on key order
 * (deep-equality is what the contract guarantees). See
 * captured-payloads/2026-05-26-usecsv-live-webhook.json.
 */
export function buildWebhookPayload(input: BuildWebhookPayloadInput): WebhookPayload {
  return {
    uploadId: input.numericId,
    importerId: input.importerKey,
    fileName: input.fileName,
    matchedColumnsMap: input.matchedColumnsMap,
    uploadedFileHeaders: input.uploadedFileHeaders,
    batch: {
      index: input.batchIndex,
      count: input.batchCount,
      totalRows: input.totalRows,
    },
    user: input.user,
    metadata: input.metadata,
    rows: input.rows,
  };
}
