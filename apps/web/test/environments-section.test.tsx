import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type GrantEnv,
  type GrantRow,
  EnvironmentsSection,
  toggleGrant,
} from "../src/components/settings/environments-section";

const envs: GrantEnv[] = [
  { id: "env_staging", slug: "staging", name: "Staging" },
  { id: "env_prod", slug: "production", name: "Production" },
];

const ownerRow: GrantRow = {
  user_id: "usr_dev",
  email: "aphisak@mohara.co",
  role: "owner",
  granted_env_ids: ["env_staging", "env_prod"],
};

const memberRow: GrantRow = {
  user_id: "usr_member",
  email: "member@mohara.co",
  role: "member",
  granted_env_ids: ["env_staging"],
};

describe("toggleGrant", () => {
  it("adds an env id when granting a member a new env", () => {
    const next = toggleGrant([memberRow], "usr_member", "env_prod", true);
    expect(next[0]!.granted_env_ids).toEqual(["env_staging", "env_prod"]);
  });

  it("removes an env id when revoking a member's grant", () => {
    const next = toggleGrant([memberRow], "usr_member", "env_staging", false);
    expect(next[0]!.granted_env_ids).toEqual([]);
  });

  it("is a no-op when the desired state already matches", () => {
    const next = toggleGrant([memberRow], "usr_member", "env_staging", true);
    expect(next[0]).toBe(memberRow); // unchanged reference
  });

  it("never mutates an owner row", () => {
    const next = toggleGrant([ownerRow], "usr_dev", "env_prod", false);
    expect(next[0]!.granted_env_ids).toEqual(["env_staging", "env_prod"]);
  });

  it("only touches the targeted user's row", () => {
    const next = toggleGrant([ownerRow, memberRow], "usr_member", "env_prod", true);
    expect(next[0]).toBe(ownerRow);
    expect(next[1]!.granted_env_ids).toEqual(["env_staging", "env_prod"]);
  });
});

describe("EnvironmentsSection", () => {
  it("renders a checked, disabled cell for owner rows with a tooltip", () => {
    render(<EnvironmentsSection environments={envs} rows={[ownerRow]} onToggle={vi.fn()} />);
    const ownerStaging = screen.getByLabelText("aphisak@mohara.co - Staging") as HTMLInputElement;
    expect(ownerStaging.checked).toBe(true);
    expect(ownerStaging.disabled).toBe(true);
    expect(ownerStaging.title).toMatch(/owner/i);
  });

  it("reflects a member's existing grants and toggles a new one with the desired state", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<EnvironmentsSection environments={envs} rows={[memberRow]} onToggle={onToggle} />);

    const staging = screen.getByLabelText("member@mohara.co - Staging") as HTMLInputElement;
    const prod = screen.getByLabelText("member@mohara.co - Production") as HTMLInputElement;
    expect(staging.checked).toBe(true);
    expect(prod.checked).toBe(false);

    // Granting production → onToggle(user, env, true).
    await user.click(prod);
    expect(onToggle).toHaveBeenCalledWith("usr_member", "env_prod", true);

    // Revoking staging → onToggle(user, env, false).
    await user.click(staging);
    expect(onToggle).toHaveBeenCalledWith("usr_member", "env_staging", false);
  });

  it("surfaces a load/toggle error", () => {
    render(
      <EnvironmentsSection
        environments={envs}
        rows={[memberRow]}
        error="Failed to update grant: 500"
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("Failed to update grant: 500")).toBeInTheDocument();
  });
});
