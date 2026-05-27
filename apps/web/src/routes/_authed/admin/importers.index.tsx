import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ImporterListView,
  type ImporterListItem,
} from "../../../components/importers/importer-list-view";
import { api } from "../../../lib/api";

export const Route = createFileRoute("/_authed/admin/importers/")({
  component: ImportersIndexRoute,
});

function ImportersIndexRoute() {
  const navigate = useNavigate();
  const [importers, setImporters] = useState<ImporterListItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await api.api.importers.$get({
          query: showArchived ? { include_archived: "true" } : {},
        });
        if (!res.ok) throw new Error(`Failed to load importers: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setImporters(data.importers as ImporterListItem[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [showArchived]);

  async function handleCreate(name: string) {
    setCreating(true);
    setError(null);
    try {
      const res = await api.api.importers.$post({ json: { name } });
      if (res.status === 409) {
        const body = await res.json();
        setError("error" in body ? body.error : "An importer with this name already exists");
        return;
      }
      if (!res.ok) throw new Error(`Failed to create importer: ${res.status}`);
      const data = await res.json();
      await navigate({ to: "/admin/importers/$id", params: { id: data.importer.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <ImporterListView
      importers={importers}
      showArchived={showArchived}
      creating={creating}
      error={error}
      onToggleArchived={setShowArchived}
      onCreate={handleCreate}
    />
  );
}
