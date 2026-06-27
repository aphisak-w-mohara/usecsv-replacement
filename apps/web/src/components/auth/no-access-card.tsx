type Props = {
  /** Sign the user out and return them to /login. */
  onSignOut: () => void;
};

/**
 * Presentational "no access" card. Shown when the user is authenticated by
 * Firebase but the worker's closed-signup gate denied them (no membership / no
 * matching invite / domain mismatch). Kept free of router + SDK so it can be
 * unit tested directly.
 */
export function NoAccessCard({ onSignOut }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">No access</h1>
        <p className="text-sm text-slate-500">
          Your account isn't a member of this workspace yet. Ask a project owner to invite you.
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="mx-auto rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
