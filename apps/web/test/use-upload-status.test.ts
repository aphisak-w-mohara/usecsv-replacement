import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadStatus } from "../src/lib/use-upload-status";
import type { UploadStatusResponse } from "../src/lib/use-upload-status";

function statusResponse(over: Partial<UploadStatusResponse> = {}): UploadStatusResponse {
  return {
    upload_id: "upl_1",
    numeric_id: 1,
    status: "dispatching",
    batch_count: 1,
    batches_delivered: 0,
    latest_attempt: null,
    row_errors: [],
    has_row_errors: false,
    ...over,
  };
}

describe("useUploadStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls every 2s and stops once status is terminal", async () => {
    const fetchStatus = vi
      .fn<(id: string) => Promise<UploadStatusResponse>>()
      .mockResolvedValueOnce(statusResponse({ status: "dispatching" }))
      .mockResolvedValueOnce(statusResponse({ status: "completed", batches_delivered: 1 }));

    const { result } = renderHook(() => useUploadStatus("upl_1", fetchStatus));

    // Initial fetch fires immediately.
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // Advance 2s -> second poll -> terminal -> stop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.status).toBe("completed");

    // No further polling after terminal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("does not poll when uploadId is null", async () => {
    const fetchStatus = vi.fn();
    renderHook(() => useUploadStatus(null, fetchStatus));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchStatus).not.toHaveBeenCalled();
  });
});
