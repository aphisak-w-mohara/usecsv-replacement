import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginCard } from "../components/auth/login-card";
import { api } from "../lib/api";

type LoginSearch = {
  return_to?: string;
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    return {
      return_to: typeof search.return_to === "string" ? search.return_to : undefined,
    };
  },
  beforeLoad: async () => {
    // A logged-in user shouldn't see the login page — bounce to the app.
    try {
      const res = await api.api.me.$get();
      if (res.ok) {
        throw redirect({ to: "/admin/importers" });
      }
    } catch (err) {
      // A redirect throw must propagate; a network error means "stay on login".
      if (err && typeof err === "object" && "to" in err) throw err;
    }
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { return_to } = Route.useSearch();
  return <LoginCard returnTo={return_to} mode={import.meta.env.MODE} />;
}
