import { useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "../../lib/cn";

type FieldProps = {
  label: ReactNode;
  /** Hint shown under the label, before the control. */
  hint?: ReactNode;
  /** Error message; when set, marks the control invalid and shows red text. */
  error?: ReactNode;
  /** Mark visually + semantically required. */
  required?: boolean;
  optional?: boolean;
  className?: string;
  /** Render-prop receiving the wiring props for the control. */
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
  }) => ReactElement;
};

/**
 * Label + control + hint/error wrapper. Wires id/aria-describedby/aria-invalid so
 * controls stay accessible without each call site repeating the plumbing.
 */
export function Field({ label, hint, error, required, optional, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = cn(hint ? hintId : undefined, error ? errId : undefined) || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-danger">*</span>}
        {optional && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
