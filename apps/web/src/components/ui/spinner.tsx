import { cn } from "../../lib/cn";

/**
 * Indeterminate loading spinner. Inherits color via currentColor.
 * `decorative` drops the status role + sr-only text — use it when the spinner
 * sits inside an already-labelled control (e.g. a Button) so it doesn't pollute
 * that element's accessible name.
 */
export function Spinner({
  className,
  label,
  decorative,
}: {
  className?: string;
  label?: string;
  decorative?: boolean;
}) {
  const svg = (
    <svg
      className={cn("size-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );

  if (decorative) return svg;

  return (
    <span role="status" aria-live="polite" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label ?? "Loading"}</span>
    </span>
  );
}
