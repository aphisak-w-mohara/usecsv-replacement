import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteAcceptCard, type InviteInfo } from "../src/components/auth/invite-accept-card";

const invite: InviteInfo = {
  project_name: "EVO",
  email: "junior@mohara.co",
  role: "member",
};

describe("InviteAcceptCard", () => {
  let hrefSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hrefSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        set href(v: string) {
          hrefSpy(v);
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a checking message while loading", () => {
    render(<InviteAcceptCard token="tok" invite={null} loading={true} gone={false} />);
    expect(screen.getByText(/checking your invite/i)).toBeInTheDocument();
  });

  it("renders the project name and role for a valid invite", () => {
    render(<InviteAcceptCard token="tok" invite={invite} loading={false} gone={false} />);
    expect(screen.getByText("EVO")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
    expect(screen.getByText(/sign in with junior@mohara.co/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
  });

  it("redirects to the Google login endpoint with return_to + invite_token on click", async () => {
    const user = userEvent.setup();
    render(<InviteAcceptCard token="tok123" invite={invite} loading={false} gone={false} />);
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(hrefSpy).toHaveBeenCalledWith(
      "/api/auth/google/login?return_to=%2Fadmin%2Fimporters&invite_token=tok123",
    );
  });

  it("shows the expired / invalid message when gone", () => {
    render(<InviteAcceptCard token="tok" invite={null} loading={false} gone={true} />);
    expect(screen.getByText(/expired or is no longer valid/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();
  });
});
