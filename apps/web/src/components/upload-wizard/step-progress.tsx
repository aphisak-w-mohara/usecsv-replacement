import { useCallback, useRef, useState } from "react";
import { buildBatches } from "../../lib/build-batches";
import { useUploadStatus, type UploadStatusResponse } from "../../lib/use-upload-status";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { FileIcon } from "../ui/icons";

/**
 * API surface, injected so the component is unit-testable without the network.
 * The route supplies a real implementation backed by the Hono RPC client.
 */
export type StepProgressApi = {
  createUpload: (input: {
    importer_environment_id: string;
    file_name: string;
    file_size: number;
    matched_columns_map: Record<string, string>;
    uploaded_file_headers: string[];
    total_rows: number;
    batch_size: number;
    batch_count: number;
    user_payload: Record<string, unknown> | null;
    metadata_payload: Record<string, unknown> | null;
    idempotency_key: string;
  }) => Promise<{ upload_id: string; numeric_id: number; status: string }>;
  sendBatch: (
    uploadId: string,
    batchIndex: number,
    rows: Array<Record<string, string | number>>,
  ) => Promise<void>;
  fetchStatus: (uploadId: string) => Promise<UploadStatusResponse>;
};

export type StepProgressProps = {
  importerEnvironmentId: string;
  fileName: string;
  fileSize: number;
  matched: Record<string, string>;
  uploadedFileHeaders: string[];
  editedRows: Record<string, string>[];
  batchSize: number;
  userPayload: Record<string, unknown> | null;
  metadataPayload: Record<string, unknown> | null;
  apiClient: StepProgressApi;
  onReset: () => void;
  onRetry?: (uploadId: string) => Promise<void> | void;
};

type Phase = "idle" | "submitting" | "polling";

export function StepProgress({
  importerEnvironmentId,
  fileName,
  fileSize,
  matched,
  uploadedFileHeaders,
  editedRows,
  batchSize,
  userPayload,
  metadataPayload,
  apiClient,
  onReset,
  onRetry,
}: StepProgressProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  // Keep the latest fetchStatus in a ref so the hook's effect deps stay stable
  // even though `apiClient` is a fresh object literal on every parent render.
  const fetchStatusRef = useRef(apiClient.fetchStatus);
  fetchStatusRef.current = apiClient.fetchStatus;
  const stableFetchStatus = useCallback((id: string) => fetchStatusRef.current(id), []);
  const [retryKey, setRetryKey] = useState(0);

  const { status } = useUploadStatus(uploadId, stableFetchStatus, retryKey);

  async function handleSubmit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPhase("submitting");
    setSubmitError(null);

    try {
      const built = buildBatches(editedRows, matched, batchSize);
      const created = await apiClient.createUpload({
        importer_environment_id: importerEnvironmentId,
        file_name: fileName,
        file_size: fileSize,
        matched_columns_map: matched,
        uploaded_file_headers: uploadedFileHeaders,
        total_rows: built.total_rows,
        batch_size: batchSize,
        batch_count: built.batch_count,
        user_payload: userPayload,
        metadata_payload: metadataPayload,
        idempotency_key: idempotencyKeyRef.current,
      });

      for (const batch of built.batches) {
        await apiClient.sendBatch(created.upload_id, batch.index, batch.rows);
      }

      setUploadId(created.upload_id);
      setPhase("polling");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed");
      setPhase("idle");
      submittingRef.current = false; // allow a retry of the whole submit
    }
  }

  async function handleRetry() {
    if (!uploadId || !onRetry) return;
    await onRetry(uploadId);
    setPhase("polling");
    setRetryKey((k) => k + 1); // restart polling via useUploadStatus restart signal
  }

  const batchCount = status?.batch_count ?? Math.max(1, Math.ceil(editedRows.length / batchSize));
  const delivered = status?.batches_delivered ?? 0;
  const pct = batchCount > 0 ? Math.round((delivered / batchCount) * 100) : 0;
  const isTerminal = status && ["completed", "halted", "failed"].includes(status.status);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-foreground">Submit &amp; deliver</h2>
        <p className="text-sm text-muted-foreground">
          {editedRows.length.toLocaleString("en-US")} rows ready. Submitting persists the upload and
          delivers each batch to the importer's webhook.
        </p>
      </header>

      {phase === "idle" && (
        <div className="flex flex-col gap-3">
          {submitError && (
            <Alert tone="danger" title="Submit failed">
              {submitError}
            </Alert>
          )}
          <Button onClick={handleSubmit} className="self-start">
            Submit import
          </Button>
        </div>
      )}

      {(phase === "submitting" || phase === "polling") && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-sm text-foreground">
            <span>
              {delivered}/{batchCount} batches delivered
            </span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-label="Batch delivery progress"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          {status?.latest_attempt && (
            <p className="text-xs text-muted-foreground">
              Latest: batch {status.latest_attempt.batch_index}, attempt{" "}
              {status.latest_attempt.attempt_number}
              {status.latest_attempt.status_code !== null
                ? ` → HTTP ${status.latest_attempt.status_code}`
                : " → no response"}
            </p>
          )}
        </div>
      )}

      {isTerminal && status?.status === "completed" && (
        <div className="flex flex-col gap-3">
          <Alert tone="success" title="Import complete">
            {status.has_row_errors ? (
              <p>
                {status.row_errors.length} row{status.row_errors.length === 1 ? "" : "s"} were
                rejected by the receiver.
              </p>
            ) : (
              <p>All rows were delivered successfully.</p>
            )}
          </Alert>
          <div className="flex flex-wrap gap-3">
            {status.has_row_errors && uploadId && (
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="bg-success-subtle text-success-subtle-foreground hover:opacity-90"
                icon={<FileIcon className="size-4" />}
              >
                <a href={`/api/uploads/${uploadId}/errors.csv`}>Download error CSV</a>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onReset}>
              Run another import
            </Button>
          </div>
        </div>
      )}

      {isTerminal && status?.status === "halted" && (
        <div className="flex flex-col gap-3">
          <Alert tone="danger" title="Import halted">
            {status.latest_attempt?.response_body && (
              <div className="mt-2 max-h-40 overflow-auto rounded bg-danger-subtle">
                <pre className="whitespace-pre-wrap break-words p-2 text-xs">
                  {status.latest_attempt.response_body}
                </pre>
              </div>
            )}
          </Alert>
          <Button variant="primary" size="sm" onClick={handleRetry} className="self-start">
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
