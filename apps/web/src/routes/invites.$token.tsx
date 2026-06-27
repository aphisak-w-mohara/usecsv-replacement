import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { InviteAcceptCard, type InviteInfo } from "../components/auth/invite-accept-card";
import { api } from "../lib/api";
import { firebaseConfigured } from "../lib/firebase";
import { startGoogleSignIn } from "../lib/firebase-login";

export const Route = createFileRoute("/invites/$token")({
  component: InviteAcceptRoute,
});

function InviteAcceptRoute() {
  const { token } = Route.useParams();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setGone(false);
      try {
        const res = await api.api.invites[":token"].$get({ param: { token } });
        if (res.status === 410 || !res.ok) {
          if (!cancelled) setGone(true);
          return;
        }
        const data = (await res.json()) as InviteInfo;
        if (!cancelled) setInvite(data);
      } catch {
        if (!cancelled) setGone(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleGoogle() {
    if (!firebaseConfigured) {
      // DEV bypass: no Firebase project — drop into the app; the worker's local
      // seam authorizes via DEV_EMAIL and lazily accepts a matching invite.
      window.location.href = "/admin/importers";
      return;
    }
    await startGoogleSignIn();
    // Popup resolved → signed in. Enter the app; requireAuth lazily materializes
    // the matching invite into a membership on the first authed request.
    window.location.href = "/admin/importers";
  }

  return (
    <InviteAcceptCard
      invite={invite}
      loading={loading}
      gone={gone}
      onGoogleSignIn={() => void handleGoogle()}
    />
  );
}
