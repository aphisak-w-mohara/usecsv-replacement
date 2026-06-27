import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { CheckIcon } from "../ui/icons";

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
  /**
   * Optional footer slot. Each step renders its own Back/Next pair (or
   * just Next, or nothing) so it can control the disabled state from its
   * own internal validation. WizardShell only owns the step indicator
   * and the content wrapper.
   */
  footer?: ReactNode;
};

export function WizardShell({ activeStep, children, footer }: WizardShellProps) {
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-8">
      <nav aria-label="Upload wizard steps">
        <ol className="flex items-center overflow-x-auto pb-1">
          {STEPS.map((step, i) => {
            const isActive = step.index === activeStep;
            const isComplete = step.index < activeStep;
            const isLast = i === STEPS.length - 1;
            return (
              <li
                key={step.index}
                className="flex shrink-0 items-center"
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex items-center gap-2",
                    isActive
                      ? "font-semibold text-foreground"
                      : isComplete
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : isComplete
                          ? "bg-success-subtle text-success-subtle-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isComplete ? <CheckIcon className="size-4" /> : step.index + 1}
                  </span>
                  <span className="whitespace-nowrap text-sm">{step.label}</span>
                </span>
                {!isLast && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mx-3 h-px w-8 shrink-0 sm:w-12",
                      isComplete ? "bg-success-subtle" : "bg-border",
                    )}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="flex-1 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
        {children}
      </main>

      {footer && <footer className="flex justify-between">{footer}</footer>}
    </div>
  );
}
