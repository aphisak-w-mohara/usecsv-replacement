/**
 * Tiny classname joiner. Drops falsy values so callers can write
 * cn("base", condition && "extra"). No clsx/tailwind-merge dependency —
 * keep order-sensitive overrides in mind when composing.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
