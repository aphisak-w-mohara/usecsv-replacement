import { Button } from "../ui/button";
import { LogoutIcon } from "../ui/icons";

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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-8 text-center text-card-foreground shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">No access</h1>
        <p className="text-sm text-muted-foreground">
          Your account isn't a member of this workspace yet. Ask a project owner to invite you.
        </p>
        <p className="text-xs text-muted-foreground">Contact a project owner for access.</p>
        <Button
          variant="outline"
          icon={<LogoutIcon className="size-4" />}
          onClick={onSignOut}
          className="mx-auto"
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
