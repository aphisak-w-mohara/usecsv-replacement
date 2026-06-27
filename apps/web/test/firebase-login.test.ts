import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Firebase SDK + our config wrapper so the login helpers can be tested
// without a real Firebase project. The helpers only orchestrate the SDK calls.
const {
  signInWithPopupSpy,
  sendSignInLinkToEmailSpy,
  signInWithEmailLinkSpy,
  isSignInWithEmailLinkSpy,
  googleProviderCtor,
  getFirebaseAuthSpy,
  fakeAuth,
} = vi.hoisted(() => {
  const fakeAuth = { __fake: "auth" };
  return {
    signInWithPopupSpy: vi.fn(async (_auth: unknown, _provider: unknown) => ({})),
    sendSignInLinkToEmailSpy: vi.fn(async () => {}),
    signInWithEmailLinkSpy: vi.fn(async () => ({})),
    isSignInWithEmailLinkSpy: vi.fn(() => false),
    googleProviderCtor: vi.fn(function GoogleAuthProvider() {}),
    getFirebaseAuthSpy: vi.fn(() => fakeAuth),
    fakeAuth,
  };
});

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: googleProviderCtor,
  signInWithPopup: signInWithPopupSpy,
  sendSignInLinkToEmail: sendSignInLinkToEmailSpy,
  signInWithEmailLink: signInWithEmailLinkSpy,
  isSignInWithEmailLink: isSignInWithEmailLinkSpy,
}));

vi.mock("../src/lib/firebase", () => ({
  getFirebaseAuth: getFirebaseAuthSpy,
}));

import {
  completeEmailLinkSignIn,
  sendEmailSignInLink,
  startGoogleSignIn,
} from "../src/lib/firebase-login";

describe("startGoogleSignIn", () => {
  afterEach(() => vi.clearAllMocks());

  it("calls signInWithPopup with a GoogleAuthProvider", async () => {
    await startGoogleSignIn();
    expect(signInWithPopupSpy).toHaveBeenCalledTimes(1);
    const [auth, provider] = signInWithPopupSpy.mock.calls[0]!;
    expect(auth).toBe(fakeAuth);
    expect(provider).toBeInstanceOf(googleProviderCtor);
  });
});

describe("sendEmailSignInLink", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://app.example.com" },
    });
  });

  it("sends a link (lowercased, trimmed) and stashes the email locally", async () => {
    await sendEmailSignInLink("  Person@Mohara.CO  ");
    expect(sendSignInLinkToEmailSpy).toHaveBeenCalledWith(
      fakeAuth,
      "person@mohara.co",
      expect.objectContaining({
        url: "https://app.example.com/login",
        handleCodeInApp: true,
      }),
    );
    expect(window.localStorage.getItem("evocsv:emailForSignIn")).toBe("person@mohara.co");
  });
});

describe("completeEmailLinkSignIn", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "https://app.example.com/login?oobCode=abc" },
    });
  });

  it("returns false when the URL is not an email sign-in link", async () => {
    isSignInWithEmailLinkSpy.mockReturnValueOnce(false);
    expect(await completeEmailLinkSignIn()).toBe(false);
    expect(signInWithEmailLinkSpy).not.toHaveBeenCalled();
  });

  it("completes sign-in using the stashed email and clears it", async () => {
    isSignInWithEmailLinkSpy.mockReturnValueOnce(true);
    window.localStorage.setItem("evocsv:emailForSignIn", "person@mohara.co");

    const completed = await completeEmailLinkSignIn();
    expect(completed).toBe(true);
    expect(signInWithEmailLinkSpy).toHaveBeenCalledWith(
      fakeAuth,
      "person@mohara.co",
      "https://app.example.com/login?oobCode=abc",
    );
    expect(window.localStorage.getItem("evocsv:emailForSignIn")).toBeNull();
  });
});
