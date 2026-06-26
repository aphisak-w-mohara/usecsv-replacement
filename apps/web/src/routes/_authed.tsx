import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { type AccessibleEnv, EnvSwitcher } from "../components/env-switcher";
import { api } from "../lib/api";
import { logout } from "../lib/auth-nav";

export type Me = {
  user: { id: string; email: string; name: string; picture_url?: string | null };
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
  accessible_environments: AccessibleEnv[];
};

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const toLogin = () => redirect({ to: "/login", search: { return_to: location.href } });

    let res: Awaited<ReturnType<typeof api.api.me.$get>>;
    try {
      res = await api.api.me.$get();
    } catch {
      // Network failure → treat as unauthenticated.
      throw toLogin();
    }
    // Any non-2xx (401 unauthorized, or anything else) → bounce to login.
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
  const [switching, setSwitching] = useState(false);

  const accessible = me.accessible_environments ?? [];
  // A member with zero env grants can't reach any env-scoped surface.
  const hasNoEnvAccess = me.role === "member" && accessible.length === 0;

  async function handleSwitch(environmentId: string) {
    setSwitching(true);
    try {
      const res = await api.api.me.environment.$post({ json: { environment_id: environmentId } });
      if (!res.ok) throw new Error(`Failed to switch environment: ${res.status}`);
      // Hard-reload so every route's loader re-fetches against the new env (this
      // also re-renders the switcher from the server-confirmed me.environment_id).
      window.location.reload();
    } catch {
      setSwitching(false); // re-enable the switcher; it still shows the current env
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold text-slate-900">evo-csv</span>
          <EnvSwitcher
            environments={accessible}
            currentId={me.environment_id}
            switching={switching}
            onSwitch={(id) => {
              void handleSwitch(id);
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          {me.role === "owner" && (
            <Link
              to="/admin/settings"
              className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
            >
              Settings
            </Link>
          )}
          <span className="text-sm text-slate-600">{me.user.name || me.user.email}</span>
          <button
            type="button"
            onClick={() => {
              void logout();
            }}
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            Logout
          </button>
        </div>
      </header>
      <main className="flex-1">{hasNoEnvAccess ? <NoEnvAccess /> : <Outlet />}</main>
    </div>
  );
}

/** Shown to a member who has been granted no environments yet. */
function NoEnvAccess() {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-10 text-center">
      <h1 className="text-xl font-semibold text-slate-900">No environment access yet</h1>
      <p className="text-sm text-slate-500">
        Ask a project owner to grant you access to an environment to start using evo-csv.
      </p>
    </div>
  );
}
