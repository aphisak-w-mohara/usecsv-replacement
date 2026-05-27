import { useEffect, useRef, useState } from "react";

export type UploadStatusResponse = {
  upload_id: string;
  numeric_id: number;
  status: "pending" | "dispatching" | "completed" | "halted" | "failed";
  batch_count: number;
  batches_delivered: number;
  latest_attempt: {
    batch_index: number;
    attempt_number: number;
    status_code: number | null;
    response_body: string | null;
  } | null;
  row_errors: Array<{ row: number; msg: string }>;
  has_row_errors: boolean;
};

const POLL_MS = 2000;
const TERMINAL = new Set(["completed", "halted", "failed"]);

/**
 * Poll the upload status endpoint every 2s, stopping on a terminal status.
 * `fetchStatus` is injectable so tests can drive it without the network.
 */
export function useUploadStatus(
  uploadId: string | null,
  fetchStatus: (id: string) => Promise<UploadStatusResponse>,
  restartKey: number = 0,
) {
  const [status, setStatus] = useState<UploadStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (!uploadId) return;
    stoppedRef.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function poll() {
      try {
        const next = await fetchStatus(uploadId!);
        if (cancelled) return;
        setStatus(next);
        if (TERMINAL.has(next.status)) {
          stoppedRef.current = true;
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load status");
      }
      if (!cancelled && !stoppedRef.current) {
        timer = setTimeout(poll, POLL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [uploadId, fetchStatus, restartKey]);

  return { status, error };
}
