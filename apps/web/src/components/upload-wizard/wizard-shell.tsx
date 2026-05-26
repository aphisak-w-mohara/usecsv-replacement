import type { ReactNode } from "react";

type Step = {
  index: number;
  label: string;
};

const STEPS: readonly Step[] = [
  { index: 0, label: "Context" },
  { index: 1, label: "Upload file" },
  { index: 2, label: "Match columns" },
  { index: 3, label: "Review & edit" },
  { index: 4, label: "Submit" },
] as const;

type WizardShellProps = {
  activeStep: number;
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
};

export function WizardShell({
  activeStep,
  children,
  onBack,
  onNext,
  nextDisabled,
  nextLabel = "Next",
}: WizardShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <ol className="flex items-center gap-2" aria-label="Upload wizard steps">
        {STEPS.map((step) => (
          <li
            key={step.index}
            className={`flex items-center gap-2 ${
              step.index === activeStep ? "font-semibold text-slate-900" : "text-slate-500"
            }`}
          >
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                step.index === activeStep
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
              aria-current={step.index === activeStep ? "step" : undefined}
            >
              {step.index + 1}
            </span>
            <span>{step.label}</span>
            {step.index < STEPS.length - 1 && <span className="text-slate-300">·</span>}
          </li>
        ))}
      </ol>

      <main className="flex-1 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {children}
      </main>

      <footer className="flex justify-between">
        <button
          type="button"
          className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
          onClick={onBack}
          disabled={!onBack || activeStep === 0}
        >
          Back
        </button>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={onNext}
          disabled={nextDisabled || !onNext}
        >
          {nextLabel}
        </button>
      </footer>
    </div>
  );
}
