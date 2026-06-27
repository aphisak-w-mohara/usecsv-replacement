import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "danger" | "warning" | "success" | "info";

const tones: Record<Tone, string> = {
  danger: "bg-danger-subtle text-danger-subtle-foreground border-danger/30",
  warning: "bg-warning-subtle text-warning-subtle-foreground border-warning/30",
  success: "bg-success-subtle text-success-subtle-foreground border-success/30",
  info: "bg-accent text-accent-foreground border-primary/20",
};

// danger and warning share the triangle-alert glyph (distinguished by color).
const TRIANGLE_ALERT = (
  <path d="M12 8v5m0 3h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.7 3h16.96a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.42 0Z" />
);

const icons: Record<Tone, ReactNode> = {
  danger: TRIANGLE_ALERT,
  warning: TRIANGLE_ALERT,
  success: <path d="m9 12 2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  info: <path d="M12 16v-5m0-3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
};

/**
 * Inline status banner. Use `role="alert"` for async errors so screen readers
 * announce them (the default when tone is danger).
 */
export function Alert({
  tone = "info",
  title,
  children,
  className,
  live,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Force an aria-live region; defaults on for danger. */
  live?: boolean;
}) {
  const isLive = live ?? tone === "danger";
  // danger announces assertively (role=alert); other live banners are polite
  // status regions so screen readers don't interrupt.
  const role = isLive ? (tone === "danger" ? "alert" : "status") : undefined;
  return (
    <div
      className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-sm", tones[tone], className)}
      role={role}
      aria-live={isLive ? "polite" : undefined}
    >
      <svg
        className="mt-0.5 size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icons[tone]}
      </svg>
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="[overflow-wrap:anywhere]">{children}</div>}
      </div>
    </div>
  );
}
