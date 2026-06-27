type Props = {
  /** Build/runtime mode shown as a small dev fingerprint. */
  mode?: string;
  /** Start the primary Google sign-in (popup). */
  onGoogleSignIn: () => void;
  /** Optional status banner (e.g. an error). */
  notice?: string | null;
};

/**
 * Presentational login card. Kept free of router context + the Firebase SDK so
 * it can be unit tested directly — the route component wires the real handler
 * (`startGoogleSignIn`).
 *
 * Google is the only sign-in method for now; the passwordless email-link path is
 * disabled (UI removed here; provider disabled in Firebase).
 */
export function LoginCard({ mode, onGoogleSignIn, notice }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold text-slate-900">evo-csv</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>

        {notice ? <p className="text-center text-sm text-slate-600">{notice}</p> : null}

        <button
          type="button"
          onClick={onGoogleSignIn}
          className="w-full rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Continue with Google
        </button>

        {mode ? <p className="text-center text-xs text-slate-400">{mode}</p> : null}
      </div>
    </div>
  );
}
