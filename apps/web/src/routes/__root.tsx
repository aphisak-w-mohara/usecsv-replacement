import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "../components/ui/button";

function FullScreenMessage({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
        <div className="mt-2 flex justify-center">{action}</div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      <Outlet />
    </div>
  ),
  errorComponent: ({ error }) => (
    <FullScreenMessage
      title="Something went wrong"
      detail={error instanceof Error ? error.message : "An unexpected error occurred."}
      action={<Button onClick={() => window.location.reload()}>Reload</Button>}
    />
  ),
  notFoundComponent: () => (
    <FullScreenMessage
      title="Page not found"
      detail="The page you're looking for doesn't exist or has moved."
      action={
        <Button asChild>
          <Link to="/">Go home</Link>
        </Button>
      }
    />
  ),
});
