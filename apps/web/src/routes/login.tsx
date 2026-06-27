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
          window.location.href = return_to ?? "/admin/importers";
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
      window.location.href = return_to ?? "/admin/importers";
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
      window.location.href = return_to ?? "/admin/importers";
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
