import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithRedirect,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

/** localStorage key holding the email mid email-link flow (the link itself
 * doesn't carry it back, so we stash it before redirecting to the mailbox). */
const EMAIL_LINK_KEY = "evocsv:emailForSignIn";

/** Kick off the primary Google sign-in (full-page redirect). */
export async function startGoogleSignIn(): Promise<void> {
  await signInWithRedirect(getFirebaseAuth(), new GoogleAuthProvider());
}

/**
 * Send a passwordless email sign-in link. The link returns the user to the app's
 * current origin; we stash the email locally so the completion step can supply it.
 */
export async function sendEmailSignInLink(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await sendSignInLinkToEmail(getFirebaseAuth(), normalized, {
    url: `${window.location.origin}/login`,
    handleCodeInApp: true,
  });
  window.localStorage.setItem(EMAIL_LINK_KEY, normalized);
}

/**
 * If the current URL is an email sign-in link, complete the sign-in. Returns
 * true when a sign-in was completed (the caller should then re-check auth state).
 * Prompts for the email only if it wasn't stashed locally (e.g. different device).
 */
export async function completeEmailLinkSignIn(): Promise<boolean> {
  const auth = getFirebaseAuth();
  const href = window.location.href;
  if (!isSignInWithEmailLink(auth, href)) return false;

  let email = window.localStorage.getItem(EMAIL_LINK_KEY);
  if (!email) {
    email = window.prompt("Confirm your email to finish signing in") ?? "";
  }
  if (!email) return false;

  await signInWithEmailLink(auth, email, href);
  window.localStorage.removeItem(EMAIL_LINK_KEY);
  return true;
}
