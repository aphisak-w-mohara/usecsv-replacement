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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold text-slate-900">evo-csv</h1>
        </div>

        {loading ? (
          <p className="text-center text-sm text-slate-500">Checking your invite…</p>
        ) : gone || !invite ? (
          <p className="text-center text-sm text-slate-600">
            This invite has expired or is no longer valid. Ask the project owner for a new one.
          </p>
        ) : (
          <>
            <p className="text-center text-sm text-slate-700">
              <span className="font-medium text-slate-900">{invite.project_name}</span> invited you
              as <span className="font-medium text-slate-900">{invite.role}</span>.
            </p>
            <button
              type="button"
              onClick={onGoogleSignIn}
              disabled={signingIn}
              aria-busy={signingIn}
              className="w-full rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {signingIn ? "Signing in…" : "Continue with Google"}
            </button>
            <p className="text-center text-xs text-slate-400">
              Sign in with {invite.email} to accept.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
