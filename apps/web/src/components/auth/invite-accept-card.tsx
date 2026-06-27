import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";

export type InviteInfo = {
  project_name: string;
  email: string;
  role: "owner" | "member";
};

type Props = {
  /** Resolved invite details, or null while loading / on error. */
  invite: InviteInfo | null;
  /** True while the initial `GET /api/invites/:token` is in flight. */
  loading: boolean;
  /** True when the lookup returned 410 (expired / accepted / unknown). */
  gone: boolean;
  /** Start Google sign-in. Acceptance is lazy: the first authed request whose
   * email matches the pending invite materializes the membership server-side. */
  onGoogleSignIn: () => void;
  /** True while Google sign-in is in flight — disables the button to block double-submit. */
  signingIn?: boolean;
};

/**
 * Presentational invite-acceptance card. Kept free of router context + the
 * Firebase SDK so it can be unit tested directly (the route feeds it the fetched
 * invite + flags + a sign-in handler).
 *
 * The invite token is no longer threaded through sign-in — acceptance happens
 * lazily on the server by matching the verified email to the pending invite.
 */
export function InviteAcceptCard({ invite, loading, gone, onGoogleSignIn, signingIn }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold text-foreground">evo-csv</h1>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            <span>Checking your invite…</span>
          </div>
        ) : gone || !invite ? (
          <Alert tone="warning" title="Invite unavailable">
            This invite has expired or is no longer valid. Ask the project owner for a new one.
          </Alert>
        ) : (
          <>
            <p className="text-center text-sm text-foreground">
              <span className="font-medium text-foreground">{invite.project_name}</span> invited you
              as <span className="font-medium text-foreground">{invite.role}</span>.
            </p>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={onGoogleSignIn}
              loading={signingIn}
            >
              {signingIn ? "Signing in…" : "Continue with Google"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Sign in with {invite.email} to accept.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
