import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectSection } from "../src/components/settings/project-section";

describe("ProjectSection", () => {
  it("prefills the field with the saved domain", () => {
    render(
      <ProjectSection
        allowedEmailDomain="mohara.co"
        mismatchedMemberCount={0}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    const field = screen.getByLabelText(/allowed email domain/i) as HTMLInputElement;
    expect(field.value).toBe("mohara.co");
  });

  it("saves the trimmed domain value", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <ProjectSection
        allowedEmailDomain={null}
        mismatchedMemberCount={0}
        saving={false}
        onSave={onSave}
      />,
    );
    await user.type(screen.getByLabelText(/allowed email domain/i), "  mohara.co  ");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith("mohara.co");
  });

  it("saves null when the field is empty (clears the restriction)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <ProjectSection
        allowedEmailDomain={null}
        mismatchedMemberCount={0}
        saving={false}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("clears via the Clear button (calls onSave(null) and empties the field)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <ProjectSection
        allowedEmailDomain="mohara.co"
        mismatchedMemberCount={0}
        saving={false}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(onSave).toHaveBeenCalledWith(null);
    const field = screen.getByLabelText(/allowed email domain/i) as HTMLInputElement;
    expect(field.value).toBe("");
  });

  it("shows the mismatch warning when set and some members differ", () => {
    render(
      <ProjectSection
        allowedEmailDomain="mohara.co"
        mismatchedMemberCount={2}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    const warning = screen.getByRole("status");
    expect(warning.textContent).toMatch(/2 existing members have a different email domain/i);
    expect(warning.textContent).toMatch(/they keep access/i);
  });

  it("hides the mismatch warning when no members differ", () => {
    render(
      <ProjectSection
        allowedEmailDomain="mohara.co"
        mismatchedMemberCount={0}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hides the mismatch warning when the restriction is cleared", () => {
    render(
      <ProjectSection
        allowedEmailDomain={null}
        mismatchedMemberCount={3}
        saving={false}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("surfaces an inline error (e.g. invalid domain 400)", () => {
    render(
      <ProjectSection
        allowedEmailDomain={null}
        mismatchedMemberCount={0}
        saving={false}
        error="Enter a valid domain like `mohara.co`."
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/enter a valid domain/i)).toBeInTheDocument();
  });
});
