import { Link, createLazyFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  StepContext,
  type StepContextSubmit,
} from "../../../components/upload-wizard/step-context";
import { StepMatchColumns } from "../../../components/upload-wizard/step-match-columns";
import {
  StepProgress,
  type StepProgressApi,
} from "../../../components/upload-wizard/step-progress";
import { StepReviewGrid } from "../../../components/upload-wizard/step-review-grid";
import { StepUploadFile } from "../../../components/upload-wizard/step-upload-file";
import { WizardShell } from "../../../components/upload-wizard/wizard-shell";
import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { ArrowLeftIcon, BoxIcon } from "../../../components/ui/icons";
import { Select } from "../../../components/ui/select";
import { Spinner } from "../../../components/ui/spinner";
import { api } from "../../../lib/api";
import type { ImporterColumn } from "../../../lib/fuzzy-match";
import type { ParseSuccess } from "../../../lib/parse-file";
import { resolveImporterEnvironmentId } from "../../../lib/resolve-importer-environment";
import type { UploadStatusResponse } from "../../../lib/use-upload-status";

export const Route = createLazyFileRoute("/_authed/admin/importers/$id_/upload")({
  component: UploadWizardRoute,
});

/** One environment row from GET /api/importers/:id/environments (picker subset). */
type EnvRow = {
  env_id: string;
  env_name: string;
  is_default: boolean;
  importer_environment: { id: string } | null;
};

type WizardState = {
  context: StepContextSubmit | null;
  parsed: ParseSuccess | null;
  matched: Record<string, string> | null;
  editedRows: Record<string, string>[] | null;
};

/** An env is a valid upload target when it's configured AND the user can access it. */
function isSelectable(env: EnvRow, accessibleIds: Set<string>): boolean {
  return env.importer_environment !== null && accessibleIds.has(env.env_id);
}

function UploadWizardRoute() {
  const { id } = Route.useParams();
  const { me } = Route.useRouteContext();
  // The upload target environment is chosen explicitly here (not inherited from a
  // global switcher). The session env is only used as the default selection.
  const accessibleIds = useMemo(
    () => new Set((me.accessible_environments ?? []).map((e) => e.id)),
    [me.accessible_environments],
  );

  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [state, setState] = useState<WizardState>({
    context: null,
    parsed: null,
    matched: null,
    editedRows: null,
  });
  const [importerColumns, setImporterColumns] = useState<ImporterColumn[] | null>(null);
  const [columnsError, setColumnsError] = useState<string | null>(null);

  // Importer environments + the operator's explicit selection.
  const [envs, setEnvs] = useState<EnvRow[] | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);

  // Environments the operator may upload to: configured for this importer AND
  // granted to the signed-in user (owners are granted every env).
  const selectableEnvs = useMemo(
    () => (envs ?? []).filter((e) => isSelectable(e, accessibleIds)),
    [envs, accessibleIds],
  );

  const envResolution = useMemo(
    () => (selectedEnvId && envs ? resolveImporterEnvironmentId(envs, selectedEnvId) : null),
    [envs, selectedEnvId],
  );

  const apiClient: StepProgressApi = {
    createUpload: async (input) => {
      const res = await api.api.uploads.$post(
        {
          json: {
            importer_environment_id: input.importer_environment_id,
            file_name: input.file_name,
            file_size: input.file_size,
            matched_columns_map: input.matched_columns_map,
            uploaded_file_headers: input.uploaded_file_headers,
            total_rows: input.total_rows,
            batch_size: input.batch_size,
            batch_count: input.batch_count,
            user_payload: input.user_payload,
            metadata_payload: input.metadata_payload,
          },
        },
        { headers: { "Idempotency-Key": input.idempotency_key } },
      );
      if (!res.ok) throw new Error(`createUpload failed: ${res.status}`);
      return res.json() as Promise<{ upload_id: string; numeric_id: number; status: string }>;
    },
    sendBatch: async (uploadId, batchIndex, rows) => {
      const res = await api.api.uploads[":upload_id"].batches[":batch_index"].$post({
        param: { upload_id: uploadId, batch_index: String(batchIndex) },
        json: { rows },
      });
      if (!res.ok) throw new Error(`sendBatch failed: ${res.status}`);
    },
    fetchStatus: async (uploadId) => {
      const res = await api.api.uploads[":upload_id"].$get({ param: { upload_id: uploadId } });
      if (!res.ok) throw new Error(`fetchStatus failed: ${res.status}`);
      return res.json() as Promise<UploadStatusResponse>;
    },
  };

  async function retryUpload(uploadId: string) {
    const res = await api.api.uploads[":upload_id"].retry.$post({
      param: { upload_id: uploadId },
    });
    if (!res.ok) throw new Error(`retry failed: ${res.status}`);
  }

  useEffect(() => {
    let cancelled = false;
    setColumnsError(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].columns.$get({
          param: { importer_id: id },
        });
        if (!res.ok) throw new Error(`Failed to fetch columns: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setImporterColumns(data.columns as ImporterColumn[]);
      } catch (err) {
        if (!cancelled) {
          setColumnsError(err instanceof Error ? err.message : "Unknown error");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setEnvError(null);
    setEnvs(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].environments.$get({
          param: { importer_id: id },
        });
        if (!res.ok) throw new Error(`Failed to load environments: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const rows = data.environments as EnvRow[];
        setEnvs(rows);
        // Default the picker to the session env when it's a valid target, else the
        // default env, else the first selectable one.
        const selectable = rows.filter((e) => isSelectable(e, accessibleIds));
        const preferred =
          selectable.find((e) => e.env_id === me.environment_id) ??
          selectable.find((e) => e.is_default) ??
          selectable[0];
        // Keep a valid manual selection if the effect re-runs (e.g. context
        // re-resolves); only (re)default when nothing valid is selected.
        setSelectedEnvId((prev) =>
          prev && selectable.some((e) => e.env_id === prev) ? prev : (preferred?.env_id ?? null),
        );
      } catch (err) {
        if (!cancelled) setEnvError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, me.environment_id, accessibleIds]);

  function handleContextSubmit(context: StepContextSubmit) {
    setState((s) => ({ ...s, context }));
    setActiveStep(1);
  }

  function handleFileParsed(parsed: ParseSuccess) {
    setState((s) => ({ ...s, parsed }));
    setActiveStep(2);
  }

  function handleMatched(matched: Record<string, string>) {
    setState((s) => ({ ...s, matched }));
    setActiveStep(3);
  }

  function handleReviewed(editedRows: Record<string, string>[]) {
    setState((s) => ({ ...s, editedRows }));
    setActiveStep(4);
  }

  const selected = selectableEnvs.find((e) => e.env_id === selectedEnvId);

  return (
    <WizardShell activeStep={activeStep}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/importers/$id" params={{ id }}>
            <ArrowLeftIcon className="size-4" />
            Back to importer
          </Link>
        </Button>
        <EnvPicker
          envs={selectableEnvs}
          selectedEnvId={selectedEnvId}
          onSelect={setSelectedEnvId}
          selectedIsDefault={selected?.is_default ?? false}
          selectedName={selected?.env_name}
          // Lock the target once the operator starts the flow so the upload can't
          // be retargeted to a different env mid-wizard.
          locked={activeStep > 0}
        />
      </div>

      {/* Block the flow up front if there's no valid target environment. */}
      {!envError && envs && selectableEnvs.length === 0 ? (
        <EmptyState
          icon={<BoxIcon className="size-6" />}
          title="No environment available to upload to"
          description="This importer has no webhook configured for an environment you can access. Configure one on the importer's Environments tab first."
          action={
            <Button asChild variant="outline">
              <Link to="/admin/importers/$id" params={{ id }}>
                Open Environments tab
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {envError && (
            <Alert tone="danger" className="mb-4">
              Couldn't load environments: {envError}
            </Alert>
          )}
          {!envError && !envs && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" /> Loading environments…
            </p>
          )}

          {envs && selectableEnvs.length > 0 && (
            <>
              {activeStep === 0 && <StepContext onSubmit={handleContextSubmit} />}

              {activeStep === 1 && (
                <StepUploadFile onParsed={handleFileParsed} onBack={() => setActiveStep(0)} />
              )}

              {activeStep === 2 && state.parsed && (
                <>
                  {columnsError && (
                    <Alert tone="danger" className="mb-4">
                      Couldn't load importer columns: {columnsError}
                    </Alert>
                  )}
                  {!importerColumns && !columnsError && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner className="size-4" /> Loading importer columns…
                    </p>
                  )}
                  {importerColumns && (
                    <StepMatchColumns
                      fileHeaders={state.parsed.headers}
                      rows={state.parsed.rows}
                      importerColumns={importerColumns}
                      onMatched={handleMatched}
                      onBack={() => setActiveStep(1)}
                    />
                  )}
                </>
              )}

              {activeStep === 3 && state.parsed && state.matched && importerColumns && (
                <StepReviewGrid
                  fileHeaders={state.parsed.headers}
                  rows={state.parsed.rows}
                  importerColumns={importerColumns}
                  matched={state.matched}
                  filterInvalidRows={false}
                  disableIfAnyInvalid={false}
                  onConfirmed={handleReviewed}
                  onBack={() => setActiveStep(2)}
                />
              )}

              {activeStep === 4 &&
                state.parsed &&
                state.matched &&
                state.context &&
                state.editedRows &&
                envResolution?.status === "resolved" && (
                  <StepProgress
                    importerEnvironmentId={envResolution.importerEnvironmentId}
                    fileName={state.parsed.fileName}
                    fileSize={state.parsed.fileSize}
                    matched={state.matched}
                    uploadedFileHeaders={state.parsed.headers}
                    editedRows={state.editedRows}
                    batchSize={1000}
                    userPayload={state.context.userPayload}
                    metadataPayload={state.context.metadataPayload}
                    apiClient={apiClient}
                    onReset={() => {
                      setState({
                        context: null,
                        parsed: null,
                        matched: null,
                        editedRows: null,
                      });
                      setActiveStep(0);
                    }}
                    onRetry={retryUpload}
                  />
                )}
            </>
          )}
        </>
      )}
    </WizardShell>
  );
}

/** Target-environment selector shown above the wizard. */
function EnvPicker({
  envs,
  selectedEnvId,
  onSelect,
  selectedIsDefault,
  selectedName,
  locked,
}: {
  envs: EnvRow[];
  selectedEnvId: string | null;
  onSelect: (id: string) => void;
  selectedIsDefault: boolean;
  selectedName?: string;
  locked?: boolean;
}) {
  if (envs.length === 0) return null;

  if (locked || envs.length === 1) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Environment</span>
        <span className="font-medium text-foreground">{selectedName}</span>
        {selectedIsDefault && <Badge tone="primary">Default</Badge>}
      </div>
    );
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Upload to</span>
      <Select
        aria-label="Target environment"
        value={selectedEnvId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="h-8 w-auto min-w-40 text-xs"
      >
        {envs.map((env) => (
          <option key={env.env_id} value={env.env_id}>
            {env.env_name}
            {env.is_default ? " (default)" : ""}
          </option>
        ))}
      </Select>
    </label>
  );
}
