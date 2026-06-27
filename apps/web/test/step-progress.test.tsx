import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StepProgress } from "../src/components/upload-wizard/step-progress";
import type { UploadStatusResponse } from "../src/lib/use-upload-status";

const baseProps = {
  importerEnvironmentId: "impenv_tenants_staging",
  fileName: "sample-tenants.csv",
  fileSize: 256,
  matched: { first_name: "First name", email: "Customer Email" },
  uploadedFileHeaders: ["First name", "Customer Email", "Notes"],
  editedRows: [
    { "First name": "Alice", "Customer Email": "a@b.com", Notes: "x" },
    { "First name": "Bob", "Customer Email": "b@b.com", Notes: "y" },
  ],
  batchSize: 1000,
  userPayload: null,
  metadataPayload: null,
};

function makeApi(overrides: {
  createUpload?: ReturnType<typeof vi.fn>;
  sendBatch?: ReturnType<typeof vi.fn>;
  fetchStatus?: (id: string) => Promise<UploadStatusResponse>;
}) {
  return {
    createUpload:
      overrides.createUpload ??
      vi.fn().mockResolvedValue({ upload_id: "upl_1", numeric_id: 1, status: "pending" }),
    sendBatch: overrides.sendBatch ?? vi.fn().mockResolvedValue(undefined),
    fetchStatus:
      overrides.fetchStatus ??
      vi.fn().mockResolvedValue({
        upload_id: "upl_1",
        numeric_id: 1,
        status: "completed",
        batch_count: 1,
        batches_delivered: 1,
        latest_attempt: {
          batch_index: 1,
          attempt_number: 1,
          status_code: 200,
          response_body: "{}",
        },
        row_errors: [],
        has_row_errors: false,
      } satisfies UploadStatusResponse),
  };
}

describe("StepProgress", () => {
  it("submits the upload + one batch, then shows the completed banner", async () => {
    const apiClient = makeApi({});
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => expect(apiClient.createUpload).toHaveBeenCalledTimes(1));
    expect(apiClient.sendBatch).toHaveBeenCalledTimes(1);
    expect(apiClient.sendBatch).toHaveBeenCalledWith(
      "upl_1",
      1,
      expect.arrayContaining([
        expect.objectContaining({ row: 1, first_name: "Alice", email: "a@b.com" }),
      ]),
    );

    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /run another import/i })).toBeInTheDocument();
  });

  it("guards against double-submit (single createUpload call)", async () => {
    const apiClient = makeApi({});
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /submit/i });
    await userEvent.click(btn);
    await userEvent.click(btn);
    await waitFor(() => expect(apiClient.createUpload).toHaveBeenCalledTimes(1));
  });

  it("shows the halted banner + Retry CTA when status is halted", async () => {
    const apiClient = makeApi({
      fetchStatus: vi.fn().mockResolvedValue({
        upload_id: "upl_1",
        numeric_id: 1,
        status: "halted",
        batch_count: 1,
        batches_delivered: 0,
        latest_attempt: {
          batch_index: 1,
          attempt_number: 6,
          status_code: 500,
          response_body: "upstream boom",
        },
        row_errors: [],
        has_row_errors: false,
      } satisfies UploadStatusResponse),
    });
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText(/import halted/i)).toBeInTheDocument());
    expect(screen.getByText(/upstream boom/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows Download error CSV when there are row errors", async () => {
    const apiClient = makeApi({
      fetchStatus: vi.fn().mockResolvedValue({
        upload_id: "upl_1",
        numeric_id: 1,
        status: "completed",
        batch_count: 1,
        batches_delivered: 1,
        latest_attempt: {
          batch_index: 1,
          attempt_number: 1,
          status_code: 200,
          response_body: "{}",
        },
        row_errors: [{ row: 2, msg: "duplicate email" }],
        has_row_errors: true,
      } satisfies UploadStatusResponse),
    });
    render(<StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));
    // With rejected rows the terminal state is a sober "delivered, some rejected"
    // notice rather than a celebration.
    await waitFor(() => expect(screen.getByText(/some rows were rejected/i)).toBeInTheDocument());
    expect(screen.getByText(/1 row was rejected by the receiver/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download error csv/i })).toBeInTheDocument();
  });

  it("calls onRetry when the Retry button is clicked in a halted state", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const apiClient = makeApi({
      fetchStatus: vi.fn().mockResolvedValue({
        upload_id: "upl_1",
        numeric_id: 1,
        status: "halted",
        batch_count: 1,
        batches_delivered: 0,
        latest_attempt: {
          batch_index: 1,
          attempt_number: 6,
          status_code: 500,
          response_body: "boom",
        },
        row_errors: [],
        has_row_errors: false,
      } satisfies UploadStatusResponse),
    });
    render(
      <StepProgress {...baseProps} apiClient={apiClient} onReset={vi.fn()} onRetry={onRetry} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledWith("upl_1");
  });
});
