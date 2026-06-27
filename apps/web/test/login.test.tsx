import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginCard } from "../src/components/auth/login-card";

describe("LoginCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the app name and Google as the only sign-in option", () => {
    render(<LoginCard onGoogleSignIn={vi.fn()} />);
    expect(screen.getByText("evo-csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
    // Email-link sign-in is disabled — no email field or link button.
    expect(screen.queryByRole("button", { name: /email me a sign-in link/i })).toBeNull();
    expect(screen.queryByLabelText(/email address/i)).toBeNull();
  });

  it("calls onGoogleSignIn when the Google button is clicked", async () => {
    const onGoogleSignIn = vi.fn();
    const user = userEvent.setup();
    render(<LoginCard onGoogleSignIn={onGoogleSignIn} />);
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(onGoogleSignIn).toHaveBeenCalledTimes(1);
  });

  it("renders a notice banner when provided", () => {
    render(<LoginCard onGoogleSignIn={vi.fn()} notice="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows the dev mode fingerprint when provided", () => {
    render(<LoginCard onGoogleSignIn={vi.fn()} mode="test" />);
    expect(screen.getByText("test")).toBeInTheDocument();
  });
});
