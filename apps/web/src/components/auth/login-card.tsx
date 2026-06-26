import { googleLoginHref } from "../../lib/auth-nav";

type Props = {
  /** Optional in-app path to return to after a successful login. */
  returnTo?: string;
  /** Build/runtime mode shown as a small dev fingerprint. */
  mode?: string;
};

/**
 * Presentational login card. Kept free of router context so it can be unit
 * tested without scaffolding a full TanStack Router (the route component below
 * just feeds it the validated `return_to` search param).
 */
export function LoginCard({ returnTo, mode }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold text-slate-900">evo-csv</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.location.href = googleLoginHref(returnTo);
          }}
          className="w-full rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Continue with Google
        </button>
        {mode ? <p className="text-center text-xs text-slate-400">{mode}</p> : null}
      </div>
    </div>
  );
}
