const MAX_BYTES = 4 * 1024;

export type ValidateResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; message: string };

/**
 * Validates a textarea's JSON contents for the upload-context form.
 * Returns `{ value: null }` for empty input (caller treats as "no payload").
 */
export function validateJsonField(raw: string): ValidateResult {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  if (new TextEncoder().encode(trimmed).byteLength > MAX_BYTES) {
    return { ok: false, message: "Payload too large — keep it under 4 KB" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: "Not valid JSON" };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: 'Must be a JSON object (e.g. {"key": "value"})' };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}
