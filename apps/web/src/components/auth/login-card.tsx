import { Alert } from "../ui/alert";
import { Button } from "../ui/button";

type Props = {
  /** Build/runtime mode shown as a small dev fingerprint. */
  mode?: string;
  /** Start the primary Google sign-in (popup). */
  onGoogleSignIn: () => void;
  /** Optional status banner (e.g. an error). */
  notice?: string | null;
  /** True while sign-in is in flight — disables the button to block double-submit. */
  loading?: boolean;
};

/**
 * Presentational login card. Kept free of router context + the Firebase SDK so
 * it can be unit tested directly — the route component wires the real handler
 * (`startGoogleSignIn`).
 *
 * Google is the only sign-in method for now; the passwordless email-link path is
 * disabled (UI removed here; provider disabled in Firebase).
 */
export function LoginCard({ mode, onGoogleSignIn, notice, loading }: Props) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold text-foreground">evo-csv</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        {notice ? <Alert tone="danger">{notice}</Alert> : null}

        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={onGoogleSignIn}
          loading={loading}
        >
          {loading ? "Signing in…" : "Continue with Google"}
        </Button>

        {mode ? <p className="text-center text-xs text-muted-foreground">{mode}</p> : null}
      </div>
    </div>
  );
}
