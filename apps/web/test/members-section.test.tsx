import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type Member,
  MembersSection,
  type PendingInvite,
} from "../src/components/settings/members-section";

const owner: Member = {
  user_id: "usr_dev",
  email: "aphisak@mohara.co",
  name: "Aphisak",
  role: "owner",
};

const pending: PendingInvite = {
  id: "inv_1",
  email: "junior@mohara.co",
  role: "member",
  expires_at: 1716000000,
};

function noop() {}

describe("MembersSection", () => {
  it("lists current members with their role", () => {
    render(
      <MembersSection
        members={[owner]}
        invites={[]}
        creating={false}
        onCreate={noop}
        onRevoke={noop}
        onDismissCreated={noop}
      />,
    );
    expect(screen.getByText("Aphisak")).toBeInTheDocument();
    expect(screen.getByText("aphisak@mohara.co")).toBeInTheDocument();
    // The owner's role badge (the literal text "owner" also appears as a
    // <select> option, so scope to the members list region).
    const memberRow = screen.getByText("aphisak@mohara.co").closest("li");
    expect(memberRow).not.toBeNull();
    expect(memberRow?.textContent).toContain("owner");
  });

  it("lists pending invites with a Revoke button and calls onRevoke", async () => {
    const user = userEvent.setup();
    const onRevoke = vi.fn();
    render(
      <MembersSection
        members={[owner]}
        invites={[pending]}
        creating={false}
        onCreate={noop}
        onRevoke={onRevoke}
        onDismissCreated={noop}
      />,
    );
    expect(screen.getByText("junior@mohara.co")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /revoke/i }));
    expect(onRevoke).toHaveBeenCalledWith("inv_1");
  });

  it("calls onCreate with the trimmed email and selected role on submit", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <MembersSection
        members={[owner]}
        invites={[]}
        creating={false}
        onCreate={onCreate}
        onRevoke={noop}
        onDismissCreated={noop}
      />,
    );
    await user.type(screen.getByLabelText(/email/i), "  newhire@mohara.co  ");
    await user.selectOptions(screen.getByLabelText(/role/i), "owner");
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    expect(onCreate).toHaveBeenCalledWith("newhire@mohara.co", "owner");
  });

  it("surfaces an inline create error (e.g. 409 duplicate)", () => {
    render(
      <MembersSection
        members={[owner]}
        invites={[]}
        creating={false}
        createError="An invite for that email is already pending."
        onCreate={noop}
        onRevoke={noop}
        onDismissCreated={noop}
      />,
    );
    expect(screen.getByText("An invite for that email is already pending.")).toBeInTheDocument();
  });

  it("shows the created invite URL with a send-manually note and a copy button", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <MembersSection
        members={[owner]}
        invites={[]}
        creating={false}
        createdInvite={{
          email: "junior@mohara.co",
          invite_url: "https://app.example.com/invites/abc",
        }}
        onCreate={noop}
        onRevoke={noop}
        onDismissCreated={noop}
      />,
    );

    expect(screen.getByText(/send this link to/i)).toBeInTheDocument();
    const field = screen.getByLabelText(/invite link/i) as HTMLInputElement;
    expect(field.value).toBe("https://app.example.com/invites/abc");

    await user.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith("https://app.example.com/invites/abc");
  });
});
