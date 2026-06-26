import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "../lib/api";
import { logout } from "../lib/auth-nav";

export type Me = {
  user: { id: string; email: string; name: string; picture_url?: string | null };
  project_id: string;
  environment_id: string;
  role: "owner" | "member";
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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold text-slate-900">evo-csv</span>
          <span className="text-xs text-slate-500">{me.environment_id}</span>
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
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
