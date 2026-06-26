import { api } from "./api";

/**
 * Build the browser-navigation URL that kicks off the Google OAuth flow.
 *
 * This is a full-page redirect target (set `window.location.href = ...`), NOT
 * an RPC/fetch call — the worker responds with a 302 to Google that the browser
 * must follow itself.
 *
 * @param returnTo optional in-app path to land on after a successful login.
 */
export function googleLoginHref(returnTo?: string): string {
  const base = "/api/auth/google/login";
  return returnTo ? `${base}?return_to=${encodeURIComponent(returnTo)}` : base;
}

/**
 * Clear the session server-side, then send the browser to the login page.
 *
 * The session cookie is HttpOnly, so the only way to end a session is to POST
 * to the worker; we then hard-navigate so all in-memory route state is dropped.
 */
export async function logout(): Promise<void> {
  await api.api.auth.logout.$post();
  window.location.href = "/login";
}
