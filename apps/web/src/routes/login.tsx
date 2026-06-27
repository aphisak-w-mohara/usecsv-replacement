import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LoginCard } from "../components/auth/login-card";
import { firebaseConfigured } from "../lib/firebase";
import {
  completeEmailLinkSignIn,
  sendEmailSignInLink,
  startGoogleSignIn,
} from "../lib/firebase-login";

type LoginSearch = {
  return_to?: string;
};

const DEFAULT_LANDING = "/admin/importers";

/**
 * Open-redirect guard. `return_to` arrives from the query string, so we only
 * honour it when it is a same-origin, path-absolute reference (`/admin/...`).
 * Anything else — an absolute URL (`https://evil.com`), a protocol-relative
 * one (`//evil.com`), or a `\`-smuggled host (`/\evil.com`, which the URL
 * parser normalises to another origin) — is dropped in favour of the default
 * landing, so a crafted `/login?return_to=...` link can't bounce the
 * just-signed-in user off-site.
 */
export function safeReturnTo(returnTo: string | undefined): string {
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return DEFAULT_LANDING;
  }
  try {
    const resolved = new URL(returnTo, window.location.origin);
    if (resolved.origin !== window.location.origin) return DEFAULT_LANDING;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return DEFAULT_LANDING;
  }
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    return {
      return_to: typeof search.return_to === "string" ? search.return_to : undefined,
    };
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { return_to } = Route.useSearch();
  const [notice, setNotice] = useState<string | null>(null);

  // On load, complete an email-link sign-in if the current URL is one. Success
  // navigates into the app (the _authed gate re-checks via onAuthStateChanged).
  useEffect(() => {
    if (!firebaseConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const completed = await completeEmailLinkSignIn();
        if (completed && !cancelled) {
          window.location.href = safeReturnTo(return_to);
        }
      } catch {
        if (!cancelled) setNotice("That sign-in link is invalid or expired. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [return_to]);

  async function handleGoogle() {
    if (!firebaseConfigured) {
      // DEV bypass: no Firebase project — the worker's local seam authorizes via
      // DEV_EMAIL, so just enter the app.
      window.location.href = safeReturnTo(return_to);
      return;
    }
    try {
      await startGoogleSignIn();
    } catch {
      setNotice("Could not start Google sign-in. Try again.");
    }
  }

  async function handleEmailLink(email: string) {
    if (!firebaseConfigured) {
      window.location.href = safeReturnTo(return_to);
      return;
    }
    try {
      await sendEmailSignInLink(email);
    } catch {
      setNotice("Could not send the sign-in link. Check the address and try again.");
      throw new Error("send failed");
    }
  }

  return (
    <LoginCard
      mode={import.meta.env.MODE}
      onGoogleSignIn={() => void handleGoogle()}
      onEmailLink={handleEmailLink}
      notice={notice}
    />
  );
}
