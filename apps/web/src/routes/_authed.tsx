import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "../components/theme-toggle";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { ChevronDownIcon, InboxIcon, LogoutIcon } from "../components/ui/icons";
import { api } from "../lib/api";
import { logout } from "../lib/auth-nav";
import { firebaseConfigured, waitForFirebaseUser } from "../lib/firebase";

/** An environment the signed-in user may access. */
export type AccessibleEnv = { id: string; slug: string; name: string };

export type Me = {
  user: { id: string; email: string; name: string; picture_url?: string | null };
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
  accessible_environments: AccessibleEnv[];
};

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }): Promise<{ me: Me }> => {
    const toLogin = () => redirect({ to: "/login", search: { return_to: location.href } });

    // Authentication gate. With Firebase configured, no signed-in user means
    // bounce to /login. The DEV bypass (no Firebase config in dev) skips this
    // and relies on the worker's local email seam to authorize.
    if (firebaseConfigured) {
      const user = await waitForFirebaseUser();
      if (!user) {
        throw toLogin();
      }
    }

    // Authorization gate: the worker runs closed-signup against the verified
    // identity. 401 → not authenticated (bounce to login); 403 → authenticated
    // but not authorized → /no-access (an unauthenticated surface). We do NOT
    // bounce a 403 to /login: they ARE signed in, so that would loop.
    let res: Awaited<ReturnType<typeof api.api.me.$get>>;
    try {
      res = await api.api.me.$get();
    } catch {
      throw toLogin();
    }
    if (res.status === 403) {
      throw redirect({ to: "/no-access" });
    }
    if (!res.ok) {
      throw toLogin();
    }
    const me = (await res.json()) as Me;
    return { me };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { me } = Route.useRouteContext();
  const accessible = me.accessible_environments ?? [];
  // A member with zero env grants can't reach any env-scoped surface.
  const hasNoEnvAccess = me.role === "member" && accessible.length === 0;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <nav className="flex items-center gap-1">
            <Link to="/" className="mr-2 flex items-center gap-2 font-semibold text-foreground">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
                ◆
              </span>
              <span className="hidden sm:inline">evo-csv</span>
            </Link>
            <NavLink to="/">Importers</NavLink>
            {me.role === "owner" && <NavLink to="/admin/settings">Settings</NavLink>}
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu name={me.user.name || me.user.email} pictureUrl={me.user.picture_url} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {hasNoEnvAccess ? <NoEnvAccess /> : <Outlet />}
      </main>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&.active]:bg-accent [&.active]:text-accent-foreground"
      activeOptions={{ exact: to === "/" }}
    >
      {children}
    </Link>
  );
}

function UserMenu({ name, pictureUrl }: { name: string; pictureUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initial = name.charAt(0).toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-sm text-foreground hover:bg-muted"
      >
        {pictureUrl ? (
          <img src={pictureUrl} alt="" className="size-7 rounded-full object-cover" />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {initial}
          </span>
        )}
        <span className="hidden max-w-32 truncate sm:inline">{name}</span>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-48 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
        >
          <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            Signed in as
            <p className="truncate font-medium text-foreground">{name}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void logout();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            <LogoutIcon className="size-4 text-muted-foreground" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Shown to a member who has been granted no environments yet. */
function NoEnvAccess() {
  return (
    <div className="py-16">
      <EmptyState
        icon={<InboxIcon className="size-6" />}
        title="No environment access yet"
        description="Ask a project owner to grant you access to an environment to start using evo-csv."
        action={
          <Button variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        }
      />
    </div>
  );
}
