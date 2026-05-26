import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  StepContext,
  type StepContextSubmit,
} from "../../../components/upload-wizard/step-context";
import { StepUploadFile } from "../../../components/upload-wizard/step-upload-file";
import { WizardShell } from "../../../components/upload-wizard/wizard-shell";
import type { ParseSuccess } from "../../../lib/parse-file";

export const Route = createFileRoute("/_authed/admin/importers/$id/upload")({
  component: UploadWizardRoute,
});

type WizardState = {
  context: StepContextSubmit | null;
  parsed: ParseSuccess | null;
};

function UploadWizardRoute() {
  const { id } = Route.useParams();
  const [activeStep, setActiveStep] = useState<0 | 1>(0);
  const [state, setState] = useState<WizardState>({ context: null, parsed: null });

  function handleContextSubmit(context: StepContextSubmit) {
    setState((s) => ({ ...s, context }));
    setActiveStep(1);
  }

  function handleFileParsed(parsed: ParseSuccess) {
    setState((s) => ({ ...s, parsed }));
    // TODO(Story #4): navigate to Step 2 (Match Columns) once that step exists.
    console.info("[wizard] step 1 -> step 2", { context: state.context, parsed });
  }

  return (
    <WizardShell activeStep={activeStep}>
      <p className="mb-4 text-xs text-slate-500">Importer: {id}</p>

      {activeStep === 0 && <StepContext onSubmit={handleContextSubmit} />}

      {activeStep === 1 && (
        <StepUploadFile onParsed={handleFileParsed} onBack={() => setActiveStep(0)} />
      )}

      {state.parsed && (
        <p className="mt-4 text-xs text-slate-500">
          Step 1 captured ({state.parsed.rowCount} rows from {state.parsed.fileName}). Step 2 lands
          in Story #4.
        </p>
      )}
    </WizardShell>
  );
}
