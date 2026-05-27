import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/admin/importers/$id")({
  component: ImporterDetailRoute,
});

function ImporterDetailRoute() {
  const { id } = Route.useParams();

  return (
    <div className="flex flex-col gap-4 p-6">
      <Link to="/admin/importers" className="text-sm text-slate-500 underline">
        ← Back to importers
      </Link>
      <h1 className="text-xl font-semibold text-slate-900">Importer {id}</h1>
      {/* Columns tab (empty state) editor lands in Story #16. */}
      <p className="text-sm text-slate-500">
        Columns editor coming soon. This importer has no columns yet.
      </p>
    </div>
  );
}
