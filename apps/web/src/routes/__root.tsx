import { Link, Outlet, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500">{detail}</p>
        <div className="mt-2 flex justify-center">{action}</div>
      </div>
    </div>
  );
}

const primaryLink =
  "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800";

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
      action={
        <button type="button" onClick={() => window.location.reload()} className={primaryLink}>
          Reload
        </button>
      }
    />
  ),
  notFoundComponent: () => (
    <FullScreenMessage
      title="Page not found"
      detail="The page you're looking for doesn't exist or has moved."
      action={
        <Link to="/" className={primaryLink}>
          Go home
        </Link>
      }
    />
  ),
});
