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
  const [context, setContext] = useState<StepContextSubmit | null>(null);

  return (
    <WizardShell activeStep={0}>
      <p className="mb-4 text-xs text-slate-500">Importer: {id}</p>
      <StepContext
        onSubmit={(value) => {
          setContext(value);
          // TODO(Story #3): replace this with router.navigate to the
          // /admin/importers/$id/upload/file step once that route exists.
          console.info("[wizard] step 0 -> step 1", value);
        }}
      />
      {context !== null && (
        <p className="mt-4 text-xs text-slate-500">Step 0 captured. Step 1 lands in Story #3.</p>
      )}
    </WizardShell>
  );
}
