import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepReviewGrid } from "../src/components/upload-wizard/step-review-grid";
import type { ImporterColumn } from "../src/lib/fuzzy-match";

const TENANT_COLUMNS: ImporterColumn[] = [
  {
    id: "col_first_name",
    name: "first_name",
    display_name: "First name",
    description: null,
    example: "Alice",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_last_name",
    name: "last_name",
    display_name: "Last name",
    description: null,
    example: "Smith",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_email",
    name: "email",
    display_name: "Customer Email",
    description: null,
    example: "alice@example.com",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "email",
    validation_format: null,
  },
];

const FILE_HEADERS = ["First name", "Last name", "Customer Email"];
const MATCHED = {
  first_name: "First name",
  last_name: "Last name",
  email: "Customer Email",
};

const GOOD_ROWS = [
  { "First name": "Alice", "Last name": "Smith", "Customer Email": "alice@example.com" },
  { "First name": "Bob", "Last name": "Jones", "Customer Email": "bob@example.com" },
  { "First name": "Carol", "Last name": "Lee", "Customer Email": "carol@example.com" },
];

const ONE_BAD_EMAIL_ROW = [
  { "First name": "Alice", "Last name": "Smith", "Customer Email": "alice@example.com" },
  { "First name": "Bob", "Last name": "Jones", "Customer Email": "not-an-email" },
  { "First name": "Carol", "Last name": "Lee", "Customer Email": "carol@example.com" },
];

function renderGrid(overrides: Partial<Parameters<typeof StepReviewGrid>[0]> = {}) {
  return render(
    <StepReviewGrid
      fileHeaders={FILE_HEADERS}
      rows={GOOD_ROWS}
      importerColumns={TENANT_COLUMNS}
      matched={MATCHED}
      filterInvalidRows={false}
      disableIfAnyInvalid={false}
      onConfirmed={() => {}}
      onBack={() => {}}
      {...overrides}
    />,
  );
}

describe("StepReviewGrid", () => {
  it("renders the summary with zero errors when all cells are valid", () => {
    renderGrid();
    expect(screen.getByText(/3 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/0 errors/i)).toBeInTheDocument();
  });

  it("flags the bad email cell and surfaces its message via title attribute", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW });
    expect(screen.getByText(/3 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/1 error/i)).toBeInTheDocument();
    const badCell = screen.getByTitle(/not a valid email address/i);
    expect(badCell).toBeInTheDocument();
    expect(badCell.textContent).toContain("not-an-email");
  });

  it("'Show only errors' filter reduces the visible row count", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW });
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /show only errors/i }));

    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("blocks Next when disableIfAnyInvalid is true and any errors exist", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW, disableIfAnyInvalid: true });
    expect(screen.getByText(/imports with errors are blocked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it("does NOT block Next when disableIfAnyInvalid is false (default)", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW, disableIfAnyInvalid: false });
    expect(screen.queryByText(/imports with errors are blocked/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled();
  });

  it("shows 'X rows will be excluded' footer when filterInvalidRows is true and errors exist", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW, filterInvalidRows: true });
    expect(screen.getByText(/1 row will be excluded/i)).toBeInTheDocument();
  });

  it("calls onConfirmed when Next is clicked", () => {
    const onConfirmed = vi.fn();
    renderGrid({ onConfirmed });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });
});
