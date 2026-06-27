import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ColumnEditor,
  EMPTY_DRAFT,
  type ColumnDraft,
} from "../src/components/importers/column-editor";

function setup(overrides: Partial<Parameters<typeof ColumnEditor>[0]> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <ColumnEditor
      mode="add"
      initial={EMPTY_DRAFT}
      saving={false}
      saveError={null}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSave, onCancel };
}

describe("ColumnEditor", () => {
  it("disables the submit button until name and display name are valid", () => {
    setup();
    const submit = screen.getByRole("button", { name: /add column/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/machine name/i), {
      target: { value: "valid_name" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Valid display" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("shows an inline error when the machine name doesn't match the regex", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/machine name/i), {
      target: { value: "Bad Name" },
    });
    expect(screen.getByText(/lowercase letters, numbers and underscores/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add column/i })).toBeDisabled();
  });

  it("hides the validation_format field unless the type is select or regex", () => {
    setup();
    expect(screen.queryByText(/options|regex pattern/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/validation type/i), {
      target: { value: "select" },
    });
    expect(screen.getByText(/options \(comma-separated\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/validation type/i), {
      target: { value: "regex" },
    });
    expect(screen.getByText(/regex pattern/i)).toBeInTheDocument();
  });

  it("calls onSave with the cleaned draft on submit", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText(/machine name/i), {
      target: { value: "phone" },
    });
    fireEvent.change(screen.getByLabelText(/display name/i), {
      target: { value: "Phone" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const draft = onSave.mock.calls[0]![0] as ColumnDraft;
    expect(draft.name).toBe("phone");
    expect(draft.display_name).toBe("Phone");
    expect(draft.validation_type).toBe("string");
    expect(draft.description).toBeNull();
  });

  it("renders saveError inline when provided", () => {
    setup({ saveError: "A column with this name already exists" });
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it("disables the machine-name field in edit mode", () => {
    setup({
      mode: "edit",
      initial: { ...EMPTY_DRAFT, name: "locked_name", display_name: "Locked" },
    });
    expect(screen.getByLabelText(/machine name/i)).toBeDisabled();
  });
});
