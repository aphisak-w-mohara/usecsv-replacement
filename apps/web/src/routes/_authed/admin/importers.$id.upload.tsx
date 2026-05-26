import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  StepContext,
  type StepContextSubmit,
} from "../../../components/upload-wizard/step-context";
import { WizardShell } from "../../../components/upload-wizard/wizard-shell";

export const Route = createFileRoute("/_authed/admin/importers/$id/upload")({
  component: UploadWizardRoute,
});

function UploadWizardRoute() {
  const { id } = Route.useParams();
  const [, setContext] = useState<StepContextSubmit | null>(null);

  return (
    <WizardShell activeStep={0}>
      <p className="mb-4 text-xs text-slate-500">Importer: {id}</p>
      <StepContext
        onSubmit={(value) => {
          setContext(value);
          // Step 1+ are out of scope for Story #2 — log the captured context
          // so the engineer integrating Story #3 can see it survives the step.
          console.info("[wizard] step 0 -> step 1", value);
          // Placeholder navigation — replace with `navigate({ to: ... })` when Step 1 exists.
          alert(
            `Step 0 captured.\n\n${JSON.stringify(value, null, 2)}\n\n(Step 1 lives in Story #3.)`,
          );
        }}
      />
    </WizardShell>
  );
}
