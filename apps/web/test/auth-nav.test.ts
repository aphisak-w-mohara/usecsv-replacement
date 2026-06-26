import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the typed RPC client so logout() doesn't make a real request.
// `vi.hoisted` makes the spy available inside the hoisted vi.mock factory.
const { logoutPost } = vi.hoisted(() => ({
  logoutPost: vi.fn(async () => new Response(null, { status: 204 })),
}));
vi.mock("../src/lib/api", () => ({
  api: { api: { auth: { logout: { $post: logoutPost } } } },
}));

import { googleLoginHref, logout } from "../src/lib/auth-nav";

describe("googleLoginHref", () => {
  it("returns the bare login URL when no return_to is given", () => {
    expect(googleLoginHref()).toBe("/api/auth/google/login");
  });

  it("appends and URL-encodes return_to", () => {
    expect(googleLoginHref("/admin/importers")).toBe(
      "/api/auth/google/login?return_to=%2Fadmin%2Fimporters",
    );
  });

  it("encodes query strings inside return_to so they don't leak as params", () => {
    expect(googleLoginHref("/admin/importers?show=archived")).toBe(
      "/api/auth/google/login?return_to=%2Fadmin%2Fimporters%3Fshow%3Darchived",
    );
  });
});

describe("logout", () => {
  let hrefSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logoutPost.mockClear();
    hrefSpy = vi.fn();
    // Replace window.location with a stub whose href setter we can observe.
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

  it("POSTs to the logout endpoint then navigates to /login", async () => {
    await logout();
    expect(logoutPost).toHaveBeenCalledTimes(1);
    expect(hrefSpy).toHaveBeenCalledWith("/login");
  });
});
