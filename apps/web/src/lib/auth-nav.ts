import { signOut } from "firebase/auth";
import { firebaseConfigured, getFirebaseAuth } from "./firebase";

/**
 * End the session and return to the login page.
 *
 * Auth is stateless — there's no server session to clear. We sign the user out
 * of Firebase (when configured) so the SDK drops the cached ID token, then
 * hard-navigate to /login to discard all in-memory route state.
 *
 * DEV bypass: when Firebase isn't configured (local dev against the worker's
 * email seam), there's no Firebase session to end — just navigate.
 */
export async function logout(): Promise<void> {
  if (firebaseConfigured) {
    try {
      await signOut(getFirebaseAuth());
    } catch {
      // Ignore sign-out failures — we navigate away regardless.
    }
  }
  window.location.href = "/login";
}
