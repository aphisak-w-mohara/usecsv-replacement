/**
 * Server-side helper that fills in `user.userId` from the session email
 * when the caller didn't supply one. Used by POST /api/uploads.
 *
 * Rules (verifiable against PRD-002 Story 1 ACs):
 *   - payload null OR empty → { userId: sessionEmail }
 *   - payload has its own userId → leave it untouched (caller's choice wins)
 *   - payload has other fields but no userId → merge in { userId: sessionEmail }
 */
export function injectUserId(
  userPayload: Record<string, unknown> | null,
  sessionEmail: string,
): Record<string, unknown> | null {
  if (userPayload === null) {
    return { userId: sessionEmail };
  }
  if ("userId" in userPayload) {
    return userPayload;
  }
  return { ...userPayload, userId: sessionEmail };
}
