import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImporterGeneralTab } from "../src/components/importers/importer-general-tab";

const BASE = {
  id: "imp_tenants",
  name: "Tenants",
  archived: false,
};

function setup(overrides: Partial<Parameters<typeof ImporterGeneralTab>[0]> = {}) {
  const onSave = vi.fn();
  const onArchive = vi.fn();
  const onUnarchive = vi.fn();
  render(
    <ImporterGeneralTab
      importer={BASE}
      saving={false}
      saveError={null}
      onSave={onSave}
      onArchive={onArchive}
      onUnarchive={onUnarchive}
      {...overrides}
    />,
  );
  return { onSave, onArchive, onUnarchive };
}

describe("ImporterGeneralTab", () => {
  it("calls onSave with the trimmed new name when Save is clicked", () => {
    const { onSave } = setup();
    const input = screen.getByLabelText(/importer name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Tenants v2  " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith("Tenants v2");
  });

  it("disables Save when the trimmed name is unchanged", () => {
    setup();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("disables Save when the trimmed name is empty", () => {
    setup();
    const input = screen.getByLabelText(/importer name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("renders the saveError inline (e.g. the 409 collision message)", () => {
    setup({ saveError: "An importer with this name already exists" });
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it("Archive opens a confirm dialog; confirming calls onArchive", () => {
    const { onArchive } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^archive importer$/i }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("Archive confirm dialog can be cancelled without calling onArchive", () => {
    const { onArchive } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onArchive).not.toHaveBeenCalled();
  });

  it("renders an Unarchive button when the importer is archived; clicking it calls onUnarchive", () => {
    const { onUnarchive } = setup({ importer: { ...BASE, archived: true } });
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unarchive/i }));
    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  it("disables Save while saving=true", () => {
    setup({ saving: true });
    const input = screen.getByLabelText(/importer name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Different name" } });
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });
});
