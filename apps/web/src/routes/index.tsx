import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // The `_authed` gate on the target bounces to /login when unauthenticated.
  beforeLoad: () => {
    throw redirect({ to: "/admin/importers" });
  },
});
