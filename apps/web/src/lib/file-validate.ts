export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_ROW_COUNT = 50_000;

export type FileValidationResult =
  | { ok: true }
  | { ok: false; code: "EXTENSION_NOT_ALLOWED" | "FILE_TOO_LARGE"; message: string };

export function validateFile(_file: File): FileValidationResult {
  throw new Error("not implemented");
}
