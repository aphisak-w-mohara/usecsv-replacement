import { createLazyFileRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
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
import { api } from "../../../lib/api";
import type { ImporterColumn } from "../../../lib/fuzzy-match";
import type { ParseSuccess } from "../../../lib/parse-file";
import {
  type ImporterEnvironmentRow,
  type ResolveResult,
  resolveImporterEnvironmentId,
} from "../../../lib/resolve-importer-environment";
import type { UploadStatusResponse } from "../../../lib/use-upload-status";

export const Route = createLazyFileRoute("/_authed/admin/importers/$id_/upload")({
  component: UploadWizardRoute,
});

type WizardState = {
  context: StepContextSubmit | null;
  parsed: ParseSuccess | null;
  matched: Record<string, string> | null;
  reviewed: boolean;
  editedRows: Record<string, string>[] | null;
};

function UploadWizardRoute() {
  const { id } = Route.useParams();
  // The active environment comes from the session (top-bar env switcher persists
  // it). The target importer_environment is (this importer + active env), resolved
  // below from the importer's environments list — never hardcoded.
  const { me } = Route.useRouteContext();
  const activeEnvironmentId = me.environment_id;
  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [state, setState] = useState<WizardState>({
    context: null,
    parsed: null,
    matched: null,
    reviewed: false,
    editedRows: null,
  });
  const [importerColumns, setImporterColumns] = useState<ImporterColumn[] | null>(null);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  // Importer display name + existence guard — shown in the header and used to
  // bail out early if the importer id in the URL doesn't resolve.
  const [importerName, setImporterName] = useState<string | null>(null);
  const [importerNotFound, setImporterNotFound] = useState(false);

  // Resolution of importer_environment_id for (this importer + active env).
  const [envResolution, setEnvResolution] = useState<ResolveResult | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);

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
    setImporterNotFound(false);
    setImporterName(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].$get({ param: { importer_id: id } });
        if (res.status === 404) {
          if (!cancelled) setImporterNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed to load importer: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setImporterName(data.importer.name);
      } catch {
        if (!cancelled) setImporterNotFound(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

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
    setEnvResolution(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].environments.$get({
          param: { importer_id: id },
        });
        if (!res.ok) throw new Error(`Failed to load environments: ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const resolution = resolveImporterEnvironmentId(
          data.environments as ImporterEnvironmentRow[],
          activeEnvironmentId,
        );
        setEnvResolution(resolution);
      } catch (err) {
        if (!cancelled) setEnvError(err instanceof Error ? err.message : "Unknown error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id, activeEnvironmentId]);

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
    setState((s) => ({ ...s, reviewed: true, editedRows }));
    setActiveStep(4);
  }

  // --- Entry gates -----------------------------------------------------------
  // Resolve the importer and its target environment BEFORE the operator invests
  // effort in the wizard. Previously these only surfaced at the final step, so a
  // missing webhook config wasted the whole flow (QA F15).
  function Gate({ tone, children }: { tone: "error" | "warn"; children: ReactNode }) {
    const cls =
      tone === "error"
        ? "rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        : "rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800";
    return (
      <WizardShell activeStep={0}>
        <p className="mb-4 text-xs text-slate-500">Importer: {importerName ?? id}</p>
        <div className={cls}>{children}</div>
      </WizardShell>
    );
  }

  if (importerNotFound) {
    return <Gate tone="error">Importer not found — it may have been removed.</Gate>;
  }
  if (envError) {
    return <Gate tone="error">Couldn't resolve the target environment: {envError}</Gate>;
  }
  if (!importerName || !envResolution || !importerColumns) {
    if (columnsError) {
      return <Gate tone="error">Couldn't load this importer's columns: {columnsError}</Gate>;
    }
    return (
      <WizardShell activeStep={0}>
        <p className="text-sm text-slate-500">Preparing upload…</p>
      </WizardShell>
    );
  }
  if (envResolution.status === "not-found") {
    return (
      <Gate tone="warn">
        The active environment isn't available for this importer. Switch environments and try again.
      </Gate>
    );
  }
  if (envResolution.status === "not-configured") {
    return (
      <Gate tone="warn">
        This importer has no webhook configured for the active environment yet. Configure it on the
        importer's Environments tab before uploading.
      </Gate>
    );
  }
  // Past the gates: importer exists, columns loaded, target env resolved.
  const resolved = envResolution;

  return (
    <WizardShell activeStep={activeStep}>
      <p className="mb-4 text-xs text-slate-500">Importer: {importerName}</p>

      {activeStep === 0 && <StepContext onSubmit={handleContextSubmit} />}

      {activeStep === 1 && (
        <StepUploadFile
          initialResult={state.parsed}
          onParsed={handleFileParsed}
          onBack={() => setActiveStep(0)}
        />
      )}

      {activeStep === 2 && state.parsed && (
        <StepMatchColumns
          fileHeaders={state.parsed.headers}
          rows={state.parsed.rows}
          importerColumns={importerColumns}
          onMatched={handleMatched}
          onBack={() => setActiveStep(1)}
        />
      )}

      {activeStep === 3 && state.parsed && state.matched && (
        <StepReviewGrid
          fileHeaders={state.parsed.headers}
          rows={state.parsed.rows}
          importerColumns={importerColumns}
          matched={state.matched}
          filterInvalidRows={resolved.filterInvalidRows}
          disableIfAnyInvalid={false}
          onConfirmed={handleReviewed}
          onBack={() => setActiveStep(2)}
        />
      )}

      {activeStep === 4 && state.parsed && state.matched && state.context && state.editedRows && (
        <StepProgress
          importerEnvironmentId={resolved.importerEnvironmentId}
          fileName={state.parsed.fileName}
          fileSize={state.parsed.fileSize}
          matched={state.matched}
          uploadedFileHeaders={state.parsed.headers}
          editedRows={state.editedRows}
          batchSize={resolved.batchSize}
          userPayload={state.context.userPayload}
          metadataPayload={state.context.metadataPayload}
          apiClient={apiClient}
          onReset={() => {
            setState({
              context: null,
              parsed: null,
              matched: null,
              reviewed: false,
              editedRows: null,
            });
            setActiveStep(0);
          }}
          onRetry={retryUpload}
        />
      )}
    </WizardShell>
  );
}
