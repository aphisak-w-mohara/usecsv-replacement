import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EnvironmentsSection, previewSlug } from "../src/components/settings/environments-section";

function noop() {}

describe("previewSlug", () => {
  it("derives a kebab slug matching the server's slugify", () => {
    expect(previewSlug("Production")).toBe("production");
    expect(previewSlug("Production EU")).toBe("production-eu");
    expect(previewSlug("  Staging 2!  ")).toBe("staging-2");
    expect(previewSlug("!!!")).toBe("");
  });
});

describe("EnvironmentsSection — add environment", () => {
  it("shows the create form only when onCreate is provided", () => {
    const { rerender } = render(
      <EnvironmentsSection environments={[]} rows={[]} onToggle={noop} />,
    );
    expect(screen.queryByRole("button", { name: /add environment/i })).not.toBeInTheDocument();

    rerender(<EnvironmentsSection environments={[]} rows={[]} onToggle={noop} onCreate={noop} />);
    expect(screen.getByRole("button", { name: /add environment/i })).toBeInTheDocument();
  });

  it("previews the derived slug and submits name + (blank) slug", async () => {
    const onCreate = vi.fn();
    render(<EnvironmentsSection environments={[]} rows={[]} onToggle={noop} onCreate={onCreate} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Production"), "Production EU");
    // Live slug preview reflects the derived slug.
    expect(screen.getByText("production-eu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add environment/i }));
    expect(onCreate).toHaveBeenCalledWith("Production EU", "");
  });

  it("passes an explicit slug through verbatim", async () => {
    const onCreate = vi.fn();
    render(<EnvironmentsSection environments={[]} rows={[]} onToggle={noop} onCreate={onCreate} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Production"), "Production EU");
    await user.type(screen.getByPlaceholderText("production-eu"), "prod-eu");
    await user.click(screen.getByRole("button", { name: /add environment/i }));
    expect(onCreate).toHaveBeenCalledWith("Production EU", "prod-eu");
  });

  it("disables submit with an empty name and surfaces a create error", () => {
    render(
      <EnvironmentsSection
        environments={[]}
        rows={[]}
        onToggle={noop}
        onCreate={noop}
        createError="An environment with this slug already exists"
      />,
    );
    expect(screen.getByRole("button", { name: /add environment/i })).toBeDisabled();
    expect(screen.getByText("An environment with this slug already exists")).toBeInTheDocument();
  });
});
