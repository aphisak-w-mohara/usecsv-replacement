import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stateless auth: logout() signs out of Firebase (when configured) then
// hard-navigates to /login. Mock the firebase wrapper + the SDK's signOut so the
// test doesn't touch a real Firebase project.
const { signOutSpy, getFirebaseAuthSpy, fakeAuth } = vi.hoisted(() => {
  const fakeAuth = { __fake: "auth" };
  return {
    signOutSpy: vi.fn(async () => {}),
    getFirebaseAuthSpy: vi.fn(() => fakeAuth),
    fakeAuth,
  };
});

vi.mock("firebase/auth", () => ({
  signOut: signOutSpy,
}));

vi.mock("../src/lib/firebase", () => ({
  firebaseConfigured: true,
  getFirebaseAuth: getFirebaseAuthSpy,
}));

import { logout } from "../src/lib/auth-nav";

describe("logout", () => {
  let hrefSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signOutSpy.mockClear();
    getFirebaseAuthSpy.mockClear();
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

  it("signs out of Firebase then navigates to /login", async () => {
    await logout();
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(signOutSpy).toHaveBeenCalledWith(fakeAuth);
    expect(hrefSpy).toHaveBeenCalledWith("/login");
  });

  it("still navigates to /login when signOut rejects", async () => {
    signOutSpy.mockRejectedValueOnce(new Error("network"));
    await logout();
    expect(hrefSpy).toHaveBeenCalledWith("/login");
  });
});
