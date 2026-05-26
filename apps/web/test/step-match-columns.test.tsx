import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepMatchColumns } from "../src/components/upload-wizard/step-match-columns";
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

const FILE_HEADERS = ["First name", "Last name", "Customer Email", "Notes"];
const ROWS = [
  {
    "First name": "Alice",
    "Last name": "Smith",
    "Customer Email": "alice@example.com",
    Notes: "VIP",
  },
  {
    "First name": "Bob",
    "Last name": "Jones",
    "Customer Email": "bob@example.com",
    Notes: "",
  },
];

function renderStep(overrides: Partial<Parameters<typeof StepMatchColumns>[0]> = {}) {
  return render(
    <StepMatchColumns
      fileHeaders={FILE_HEADERS}
      rows={ROWS}
      importerColumns={TENANT_COLUMNS}
      onMatched={() => {}}
      onBack={() => {}}
      {...overrides}
    />,
  );
}

describe("StepMatchColumns", () => {
  it("auto-suggests matches and shows 'All required columns matched'", () => {
    renderStep();
    expect(screen.getByText(/3 of 3 required matched/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled();
  });

  it("shows missing required when one of the required columns is unmatched", () => {
    const { container } = renderStep({ fileHeaders: ["First name", "Last name", "Notes"] });
    expect(container.textContent).toMatch(/missing:.*customer email/i);
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it("shows counts of matched required and ignored in the banner", () => {
    const { container } = renderStep();
    // The auto-suggestion matches all 3 required cols, ignores "Notes"
    expect(screen.getByText(/3 of 3 required matched/i)).toBeInTheDocument();
    expect(container.textContent).toMatch(/1 ignored/i);
  });

  it("calls onMatched with the inverted map { machine_name: file_header } when Next is clicked", () => {
    const onMatched = vi.fn();
    renderStep({ onMatched });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(onMatched).toHaveBeenCalledTimes(1);
    expect(onMatched).toHaveBeenCalledWith({
      first_name: "First name",
      last_name: "Last name",
      email: "Customer Email",
    });
  });

  it("excludes ignored file headers from the inverted map", () => {
    const onMatched = vi.fn();
    renderStep({ onMatched });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    const arg = onMatched.mock.calls[0]?.[0];
    expect(arg.Notes).toBeUndefined();
  });

  it("unsets the previous file header when a new one claims the same importer column", () => {
    renderStep();
    const selects = screen.getAllByRole("combobox");
    const lastNameDropdown = selects.find(
      (el) => el.getAttribute("aria-label") === "Map column Last name",
    );
    expect(lastNameDropdown).toBeDefined();
    fireEvent.change(lastNameDropdown!, { target: { value: "first_name" } });

    const firstNameDropdown = selects.find(
      (el) => el.getAttribute("aria-label") === "Map column First name",
    );
    expect(firstNameDropdown).toHaveValue("__ignore__");
    expect(lastNameDropdown).toHaveValue("first_name");
  });

  it("calls onBack when Back is clicked", () => {
    const onBack = vi.fn();
    renderStep({ onBack });
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
