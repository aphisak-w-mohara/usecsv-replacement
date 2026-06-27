import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

/** localStorage key holding the email mid email-link flow (the link itself
 * doesn't carry it back, so we stash it before redirecting to the mailbox). */
const EMAIL_LINK_KEY = "evocsv:emailForSignIn";

/**
 * Kick off the primary Google sign-in via a popup. We deliberately use popup,
 * not redirect: the app is served from a different domain than Firebase's
 * `authDomain` (single-origin worker vs. *.firebaseapp.com), and modern browsers
 * block the third-party cookies `signInWithRedirect`'s cross-domain resolver
 * needs — so redirect silently fails to persist the session. The popup is
 * first-party to the auth domain and returns the credential via postMessage,
 * which works without third-party cookies. Resolves once signed in.
 */
export async function startGoogleSignIn(): Promise<void> {
  await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
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
