import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepUploadFile } from "../src/components/upload-wizard/step-upload-file";

const TENANTS_CSV = [
  "First name,Last name,Customer Email",
  "Alice,Smith,alice@example.com",
  "Bob,Jones,bob@example.com",
  "Carol,Lee,carol.lee@example.com",
].join("\n");

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

describe("StepUploadFile", () => {
  it("renders an empty drop zone initially with no Next button enabled", () => {
    render(<StepUploadFile onParsed={() => {}} onBack={() => {}} />);
    expect(screen.getByText(/drag and drop|click to browse/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/upload file/i)).toBeInTheDocument();
    const next = screen.getByRole("button", { name: /^next$/i });
    expect(next).toBeDisabled();
  });

  it("renders the file preview after a successful parse", async () => {
    const { container } = render(<StepUploadFile onParsed={() => {}} onBack={() => {}} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile("tenants.csv", TENANTS_CSV)] } });

    await waitFor(() => {
      expect(screen.getByText(/tenants\.csv/)).toBeInTheDocument();
    });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/3 rows/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled();
  });

  it("shows an error and disables Next when the file is unsupported", async () => {
    const { container } = render(<StepUploadFile onParsed={() => {}} onBack={() => {}} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile("notes.txt", "stuff")] } });

    await waitFor(() => {
      expect(screen.getByText(/only .*csv.*tsv.*xls/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it('"Upload a different file" resets state', async () => {
    const { container } = render(<StepUploadFile onParsed={() => {}} onBack={() => {}} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile("tenants.csv", TENANTS_CSV)] } });

    await waitFor(() => {
      expect(screen.getByText(/tenants\.csv/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /upload a different file/i }));

    expect(screen.queryByText(/tenants\.csv/)).not.toBeInTheDocument();
    expect(screen.getByText(/drag and drop|click to browse/i)).toBeInTheDocument();
  });

  it("calls onParsed with the ParseSuccess when Next is clicked", async () => {
    const onParsed = vi.fn();
    const { container } = render(<StepUploadFile onParsed={onParsed} onBack={() => {}} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [csvFile("tenants.csv", TENANTS_CSV)] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(onParsed).toHaveBeenCalledTimes(1);
    const arg = onParsed.mock.calls[0]?.[0];
    expect(arg.ok).toBe(true);
    expect(arg.format).toBe("csv");
    expect(arg.rowCount).toBe(3);
  });

  it("handles a file dropped onto the drop zone", async () => {
    const onParsed = vi.fn();
    render(<StepUploadFile onParsed={onParsed} onBack={() => {}} />);

    const dropZone = screen.getByLabelText(/upload file/i);
    const file = csvFile("dropped.csv", TENANTS_CSV);

    // Simulate a drag-and-drop sequence
    fireEvent.dragOver(dropZone, { dataTransfer: { files: [file] } });
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/dropped\.csv/)).toBeInTheDocument();
    });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled();
  });

  it("calls onBack when Back is clicked", () => {
    const onBack = vi.fn();
    render(<StepUploadFile onParsed={() => {}} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
