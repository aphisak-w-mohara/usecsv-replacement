import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type AccessibleEnv, EnvSwitcher } from "../src/components/env-switcher";

const envs: AccessibleEnv[] = [
  { id: "env_staging", slug: "staging", name: "Staging" },
  { id: "env_prod", slug: "production", name: "Production" },
];

describe("EnvSwitcher", () => {
  it("shows a no-access hint when there are no accessible environments", () => {
    render(<EnvSwitcher environments={[]} currentId="" onSwitch={vi.fn()} />);
    expect(screen.getByText(/no environment access/i)).toBeInTheDocument();
    // No select to switch with.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders a static label (no select) when only one env is accessible", () => {
    render(<EnvSwitcher environments={[envs[0]!]} currentId="env_staging" onSwitch={vi.fn()} />);
    expect(screen.getByText("Staging")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders a select of accessible envs and fires onSwitch on a new pick", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(<EnvSwitcher environments={envs} currentId="env_staging" onSwitch={onSwitch} />);

    const select = screen.getByLabelText("Environment");
    await user.selectOptions(select, "env_prod");
    expect(onSwitch).toHaveBeenCalledWith("env_prod");
  });

  it("does not fire onSwitch when selecting the already-active env", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(<EnvSwitcher environments={envs} currentId="env_staging" onSwitch={onSwitch} />);

    // Re-selecting the current value should be a no-op.
    await user.selectOptions(screen.getByLabelText("Environment"), "env_staging");
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
