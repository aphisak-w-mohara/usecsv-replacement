export type ValidateResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; message: string };

export function validateJsonField(_raw: string): ValidateResult {
  throw new Error("not implemented");
}
