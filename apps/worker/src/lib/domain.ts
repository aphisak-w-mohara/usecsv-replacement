/** Email-domain helpers shared by the closed-signup gate (closed-signup.ts),
 * invite creation, and the project-settings PATCH (PRD-004 Story 5 —
 * allowed_email_domain enforcement). */

/**
 * The domain part of an email (everything after the last `@`), lowercased.
 * Returns null when the input has no `@` or an empty domain part — callers treat
 * that as a non-match rather than crashing.
 */
export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.length > 0 ? domain : null;
}

/**
 * A loose-but-safe domain validator for the owner-supplied
 * `allowed_email_domain`: at least one dot, only letters/digits/hyphens per
 * label, no leading/trailing/double dots. Good enough to reject `mohara` or
 * `not a domain` while accepting `mohara.co`, `sub.example.com`.
 */
export function isValidDomain(value: string): boolean {
  if (!value.includes(".")) return false;
  return /^(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))+$/.test(value.toLowerCase());
}
