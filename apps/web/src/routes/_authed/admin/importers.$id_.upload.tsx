import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import type { UploadStatusResponse } from "../../../lib/use-upload-status";

export const Route = createFileRoute("/_authed/admin/importers/$id_/upload")({
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

  // TODO(env-resolution): the wizard only knows the importer id from the route.
  // Uploads need the importer_environment id. There's no environment-picker UI yet,
  // so for the dev seed we use the single seeded importer_environment. Replace this
  // with a real lookup (importer_id + session active environment -> importer_environment)
  // when the environment selector ships.
  const importerEnvironmentId = "impenv_tenants_staging";

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

  return (
    <WizardShell activeStep={activeStep}>
      <p className="mb-4 text-xs text-slate-500">Importer: {id}</p>

      {activeStep === 0 && <StepContext onSubmit={handleContextSubmit} />}

      {activeStep === 1 && (
        <StepUploadFile onParsed={handleFileParsed} onBack={() => setActiveStep(0)} />
      )}

      {activeStep === 2 && state.parsed && (
        <>
          {columnsError && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn't load importer columns: {columnsError}
            </div>
          )}
          {!importerColumns && !columnsError && (
            <p className="text-sm text-slate-500">Loading importer columns…</p>
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

      {activeStep === 4 && state.parsed && state.matched && state.context && state.editedRows && (
        <StepProgress
          importerEnvironmentId={importerEnvironmentId}
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
            setState({ context: null, parsed: null, matched: null, reviewed: false, editedRows: null });
            setActiveStep(0);
          }}
          onRetry={retryUpload}
        />
      )}
    </WizardShell>
  );
}
