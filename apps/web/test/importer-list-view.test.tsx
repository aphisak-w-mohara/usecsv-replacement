import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ImporterListView,
  type ImporterListItem,
} from "../src/components/importers/importer-list-view";

const tenants: ImporterListItem = {
  id: "imp_tenants",
  name: "Tenants",
  column_count: 3,
  env_count: 1,
  archived: false,
  updated_at: 1716000000,
};

function noop() {}

describe("ImporterListView", () => {
  it("renders a row per importer with its counts", () => {
    render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    expect(screen.getByText("Tenants")).toBeInTheDocument();
    expect(screen.getByText(/3 columns/)).toBeInTheDocument();
    expect(screen.getByText(/1 environment/)).toBeInTheDocument();
  });

  it("shows when each importer was last updated", () => {
    render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    // tenants.updated_at = 1716000000 (seconds) -> a real date; we render a
    // locale date string prefixed with "Updated". Assert the label appears
    // and the correct year (2024) is shown, locale-independently.
    const updated = screen.getByText(/updated/i);
    expect(updated).toBeInTheDocument();
    expect(updated.textContent).toContain(new Date(1716000000 * 1000).getFullYear().toString());
  });

  it("shows a loading line instead of the empty state while loading", () => {
    render(
      <ImporterListView
        importers={[]}
        showArchived={false}
        creating={false}
        loading={true}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    expect(screen.getByText(/loading importers/i)).toBeInTheDocument();
    expect(screen.queryByText(/create your first importer/i)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no importers", () => {
    render(
      <ImporterListView
        importers={[]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    expect(screen.getByText(/create your first importer/i)).toBeInTheDocument();
  });

  it("disables the create button until a non-whitespace name is entered", async () => {
    const user = userEvent.setup();
    render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    const button = screen.getByRole("button", { name: /create importer/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/new importer name/i), "   ");
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/new importer name/i), "Properties");
    expect(button).toBeEnabled();
  });

  it("calls onCreate with the trimmed name on submit", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={onCreate}
      />,
    );
    await user.type(screen.getByLabelText(/new importer name/i), "  Properties  ");
    await user.click(screen.getByRole("button", { name: /create importer/i }));
    expect(onCreate).toHaveBeenCalledWith("Properties");
  });

  it("opens the importer when its name or Settings is clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
        onOpen={onOpen}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Tenants" }));
    await user.click(screen.getByRole("button", { name: /settings/i }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith("imp_tenants");
  });

  it("starts the upload wizard from a non-archived row", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
        onUpload={onUpload}
      />,
    );
    await user.click(screen.getByRole("button", { name: /upload/i }));
    expect(onUpload).toHaveBeenCalledWith("imp_tenants");
  });

  it("hides the Upload action for archived importers", () => {
    render(
      <ImporterListView
        importers={[{ ...tenants, archived: true }]}
        showArchived={true}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
        onUpload={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
    // Still openable via Settings even when archived.
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("calls onToggleArchived when the show-archived checkbox is toggled", async () => {
    const user = userEvent.setup();
    const onToggleArchived = vi.fn();
    render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={onToggleArchived}
        onCreate={noop}
      />,
    );
    await user.click(screen.getByLabelText(/show archived/i));
    expect(onToggleArchived).toHaveBeenCalledWith(true);
  });

  it("surfaces an error message when provided", () => {
    render(
      <ImporterListView
        importers={[]}
        showArchived={false}
        creating={false}
        error="An importer with this name already exists"
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    expect(screen.getByText("An importer with this name already exists")).toBeInTheDocument();
  });

  it("retains the typed name when a create fails (error surfaced)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    const input = screen.getByLabelText(/new importer name/i) as HTMLInputElement;
    await user.type(input, "Properties");

    // Parent starts the create...
    rerender(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={true}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    // ...then it fails: creating goes false, error appears.
    rerender(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        error="An importer with this name already exists"
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );

    expect(input.value).toBe("Properties");
  });

  it("clears the input after a successful create completes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    const input = screen.getByLabelText(/new importer name/i) as HTMLInputElement;
    await user.type(input, "Properties");

    rerender(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={true}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );
    rerender(
      <ImporterListView
        importers={[tenants]}
        showArchived={false}
        creating={false}
        onToggleArchived={noop}
        onCreate={noop}
      />,
    );

    expect(input.value).toBe("");
  });
});
