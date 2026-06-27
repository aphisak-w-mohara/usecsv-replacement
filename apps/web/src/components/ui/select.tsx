import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const selectBase =
  "w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 text-sm text-foreground " +
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

/** Native select with a custom chevron so it matches Input styling across themes. */
export function Select({ className, invalid, children, ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(selectBase, "h-9", className)}
        aria-invalid={invalid || undefined}
        {...rest}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}
