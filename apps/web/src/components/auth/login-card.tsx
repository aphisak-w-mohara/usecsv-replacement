import { type FormEvent, useState } from "react";

type Props = {
  /** Build/runtime mode shown as a small dev fingerprint. */
  mode?: string;
  /** Start the primary Google sign-in (full-page redirect). */
  onGoogleSignIn: () => void;
  /** Send a passwordless email sign-in link to the given address. */
  onEmailLink: (email: string) => Promise<void> | void;
  /** Optional status banner (e.g. "Check your email" / an error). */
  notice?: string | null;
};

/**
 * Presentational login card. Kept free of router context + the Firebase SDK so
 * it can be unit tested directly — the route component wires the real handlers
 * (`startGoogleSignIn` / `sendEmailSignInLink`).
 *
 * Google is the primary action; the email sign-in link is the secondary path.
 */
export function LoginCard({ mode, onGoogleSignIn, onEmailLink, notice }: Props) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      await onEmailLink(email);
      setSent(true);
    } finally {
      setSending(false);
    }
  }

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

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        {sent ? (
          <p className="text-center text-sm text-slate-600">Check your inbox for a sign-in link.</p>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleEmailSubmit}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              aria-label="Email address"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <button
              type="submit"
              disabled={sending}
              className="w-full rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}

        {mode ? <p className="text-center text-xs text-slate-400">{mode}</p> : null}
      </div>
    </div>
  );
}
