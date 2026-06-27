import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteAcceptCard, type InviteInfo } from "../src/components/auth/invite-accept-card";

const invite: InviteInfo = {
  project_name: "EVO",
  email: "junior@mohara.co",
  role: "member",
};

describe("InviteAcceptCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a checking message while loading", () => {
    render(<InviteAcceptCard invite={null} loading={true} gone={false} onGoogleSignIn={vi.fn()} />);
    expect(screen.getByText(/checking your invite/i)).toBeInTheDocument();
  });

  it("renders the project name and role for a valid invite", () => {
    render(
      <InviteAcceptCard invite={invite} loading={false} gone={false} onGoogleSignIn={vi.fn()} />,
    );
    expect(screen.getByText("EVO")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
    expect(screen.getByText(/sign in with junior@mohara.co/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("calls onGoogleSignIn when Continue with Google is clicked", async () => {
    const onGoogleSignIn = vi.fn();
    const user = userEvent.setup();
    render(
      <InviteAcceptCard
        invite={invite}
        loading={false}
        gone={false}
        onGoogleSignIn={onGoogleSignIn}
      />,
    );
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows the expired / invalid message when gone", () => {
    render(<InviteAcceptCard invite={null} loading={false} gone={true} onGoogleSignIn={vi.fn()} />);
    expect(screen.getByText(/expired or is no longer valid/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue with google/i })).not.toBeInTheDocument();
  });
});
