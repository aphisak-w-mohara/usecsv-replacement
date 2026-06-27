import { createFileRoute } from "@tanstack/react-router";
import { NoAccessCard } from "../components/auth/no-access-card";
import { logout } from "../lib/auth-nav";

/**
 * Unauthenticated surface (sibling of /login) shown when an authenticated user
 * is denied by the worker's closed-signup gate (403). Kept outside `_authed` so
 * rendering it never loops back through the auth gate.
 */
export const Route = createFileRoute("/no-access")({
  component: NoAccessRoute,
});

function NoAccessRoute() {
  return <NoAccessCard onSignOut={() => void logout()} />;
}
