import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ImporterDetailTabs,
  type ImporterTabKey,
} from "../../../components/importers/importer-detail-tabs";
import {
  ImporterGeneralTab,
  type GeneralTabImporter,
} from "../../../components/importers/importer-general-tab";
import { ColumnsTab } from "../../../components/importers/columns-tab";
import { EnvironmentsTab } from "../../../components/importers/environments-tab";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { ArrowLeftIcon, UploadIcon } from "../../../components/ui/icons";
import { Spinner } from "../../../components/ui/spinner";
import { api } from "../../../lib/api";

export const Route = createFileRoute("/_authed/admin/importers/$id")({
  component: ImporterDetailRoute,
});

type ImporterRow = GeneralTabImporter & {
  column_count: number;
  env_count: number;
  updated_at: number;
};

function ImporterDetailRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [importer, setImporter] = useState<ImporterRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].$get({
          param: { importer_id: id },
        });
        if (res.status === 404) {
          if (!cancelled) setLoadError("Importer not found");
          return;
        }
        if (!res.ok) throw new Error(`Failed to load importer: ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setImporter(data.importer as ImporterRow);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function patchImporter(body: { name?: string; archived?: boolean }) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.api.importers[":importer_id"].$patch({
        param: { importer_id: id },
        json: body,
      });
      if (res.status === 409) {
        const errBody = (await res.json()) as { error?: string };
        setSaveError(errBody.error ?? "An importer with this name already exists");
        return null;
      }
      if (!res.ok) throw new Error(`Failed to update importer: ${res.status}`);
      const data = await res.json();
      return data.importer as ImporterRow;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(newName: string) {
    const next = await patchImporter({ name: newName });
    if (next) setImporter(next);
  }

  async function handleArchive() {
    const next = await patchImporter({ archived: true });
    if (next) {
      await navigate({ to: "/admin/importers" });
    }
  }

  async function handleUnarchive() {
    const next = await patchImporter({ archived: false });
    if (next) setImporter(next);
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/importers">
            <ArrowLeftIcon className="size-4" />
            Back to importers
          </Link>
        </Button>
        <Alert tone="danger" title="Couldn’t load importer">
          {loadError}
        </Alert>
      </div>
    );
  }

  if (!importer) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/importers">
            <ArrowLeftIcon className="size-4" />
            Back to importers
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label="Loading importer" />
          <span>Loading importer…</span>
        </div>
      </div>
    );
  }

  const uploadDisabled = importer.archived;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/admin/importers">
            <ArrowLeftIcon className="size-4" />
            Back to importers
          </Link>
        </Button>
        {uploadDisabled ? (
          <Button
            disabled
            icon={<UploadIcon className="size-4" />}
            title="Archived importers can’t accept new uploads"
          >
            Upload data
          </Button>
        ) : (
          <Button asChild>
            <Link to="/admin/importers/$id/upload" params={{ id: importer.id }}>
              <UploadIcon className="size-4" />
              Upload data
            </Link>
          </Button>
        )}
      </div>
      <ImporterDetailTabs
        importerName={importer.name}
        renderTab={(tab: ImporterTabKey) => {
          if (tab === "general") {
            return (
              <ImporterGeneralTab
                importer={{ id: importer.id, name: importer.name, archived: importer.archived }}
                saving={saving}
                saveError={saveError}
                onSave={handleSave}
                onArchive={handleArchive}
                onUnarchive={handleUnarchive}
              />
            );
          }
          if (tab === "columns") {
            return <ColumnsTab importerId={importer.id} />;
          }
          return <EnvironmentsTab importerId={importer.id} />;
        }}
      />
    </div>
  );
}
