import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  StepContext,
  type StepContextSubmit,
} from "../../../components/upload-wizard/step-context";
import { StepMatchColumns } from "../../../components/upload-wizard/step-match-columns";
import { StepReviewGrid } from "../../../components/upload-wizard/step-review-grid";
import { StepUploadFile } from "../../../components/upload-wizard/step-upload-file";
import { WizardShell } from "../../../components/upload-wizard/wizard-shell";
import { api } from "../../../lib/api";
import type { ImporterColumn } from "../../../lib/fuzzy-match";
import type { ParseSuccess } from "../../../lib/parse-file";

export const Route = createFileRoute("/_authed/admin/importers/$id/upload")({
  component: UploadWizardRoute,
});

type WizardState = {
  context: StepContextSubmit | null;
  parsed: ParseSuccess | null;
  matched: Record<string, string> | null;
  reviewed: boolean;
};

function UploadWizardRoute() {
  const { id } = Route.useParams();
  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3>(0);
  const [state, setState] = useState<WizardState>({
    context: null,
    parsed: null,
    matched: null,
    reviewed: false,
  });
  const [importerColumns, setImporterColumns] = useState<ImporterColumn[] | null>(null);
  const [columnsError, setColumnsError] = useState<string | null>(null);

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

  function handleReviewed() {
    setState((s) => {
      // TODO(Story #6/#7): Story #6 will add inline editing on top of this
      // grid; Story #7 will replace this with the actual submit + batch
      // dispatch using s.context + s.parsed + s.matched.
      console.info("[wizard] step 3 -> step 4", {
        context: s.context,
        parsed: s.parsed,
        matched: s.matched,
      });
      return { ...s, reviewed: true };
    });
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

      {state.reviewed && (
        <p className="mt-4 text-xs text-slate-500">
          Step 3 captured. Steps 4-5 (inline edit + submit) land in Stories #6 + #7.
        </p>
      )}
    </WizardShell>
  );
}
