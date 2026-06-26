import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginCard } from "../src/components/auth/login-card";

describe("LoginCard", () => {
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

  it("renders the app name and a Continue with Google button", () => {
    render(<LoginCard />);
    expect(screen.getByText("evo-csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
  });

  it("navigates to the Google login endpoint on click (no return_to)", async () => {
    const user = userEvent.setup();
    render(<LoginCard />);
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(hrefSpy).toHaveBeenCalledWith("/api/auth/google/login");
  });

  it("encodes return_to into the login URL on click", async () => {
    const user = userEvent.setup();
    render(<LoginCard returnTo="/admin/importers" />);
    await user.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(hrefSpy).toHaveBeenCalledWith("/api/auth/google/login?return_to=%2Fadmin%2Fimporters");
  });

  it("shows the dev mode fingerprint when provided", () => {
    render(<LoginCard mode="test" />);
    expect(screen.getByText("test")).toBeInTheDocument();
  });
});
