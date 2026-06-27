import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginCard } from "../src/components/auth/login-card";

describe("LoginCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the app name and both sign-in options", () => {
    render(<LoginCard onGoogleSignIn={vi.fn()} onEmailLink={vi.fn()} />);
    expect(screen.getByText("evo-csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /email me a sign-in link/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("calls onGoogleSignIn when the Google button is clicked", async () => {
    const onGoogleSignIn = vi.fn();
    const user = userEvent.setup();
    render(<LoginCard onGoogleSignIn={onGoogleSignIn} onEmailLink={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it("calls onEmailLink with the typed email, then shows the inbox notice", async () => {
    const onEmailLink = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<LoginCard onGoogleSignIn={vi.fn()} onEmailLink={onEmailLink} />);

    await user.type(screen.getByLabelText(/email address/i), "person@mohara.co");
    await user.click(screen.getByRole("button", { name: /email me a sign-in link/i }));

    expect(onEmailLink).toHaveBeenCalledWith("person@mohara.co");
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  it("renders a notice banner when provided", () => {
    render(
      <LoginCard onGoogleSignIn={vi.fn()} onEmailLink={vi.fn()} notice="Something went wrong" />,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows the dev mode fingerprint when provided", () => {
    render(<LoginCard onGoogleSignIn={vi.fn()} onEmailLink={vi.fn()} mode="test" />);
    expect(screen.getByText("test")).toBeInTheDocument();
  });
});
