import {
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
} from "react";
import { cn } from "../../lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-muted text-foreground hover:bg-accent",
  outline: "border border-input bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-danger text-danger-foreground hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-sm",
  icon: "h-9 w-9",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Optional leading icon node. */
  icon?: ReactNode;
  /** Render the single child element with button styling (e.g. a router Link). */
  asChild?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  asChild = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = cn(base, variants[variant], sizes[size], className);

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string; children?: ReactNode }>;
    const lead = loading ? <Spinner className="size-4" decorative /> : icon;
    return cloneElement(
      child,
      { className: cn(classes, child.props.className) },
      lead,
      child.props.children,
    );
  }

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" decorative /> : icon}
      {children}
    </button>
  );
}
