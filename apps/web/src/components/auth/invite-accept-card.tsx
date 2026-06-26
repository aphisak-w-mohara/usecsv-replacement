import { googleLoginHref } from "../../lib/auth-nav";

export type InviteInfo = {
  project_name: string;
  email: string;
  role: "owner" | "member";
};

type Props = {
  /** The invite token from the URL, threaded into the Google login redirect. */
  token: string;
  /** Resolved invite details, or null while loading / on error. */
  invite: InviteInfo | null;
  /** True while the initial `GET /api/invites/:token` is in flight. */
  loading: boolean;
  /** True when the lookup returned 410 (expired / accepted / unknown). */
  gone: boolean;
};

/**
 * Presentational invite-acceptance card. Kept free of router context so it can
 * be unit tested without scaffolding TanStack Router (the route component feeds
 * it the fetched invite + loading/gone flags).
 */
export function InviteAcceptCard({ token, invite, loading, gone }: Props) {
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
              onClick={() => {
                window.location.href = googleLoginHref("/admin/importers", token);
              }}
              className="w-full rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Continue with Google
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
