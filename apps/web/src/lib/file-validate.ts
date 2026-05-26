export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ROW_COUNT = 50_000;

const ALLOWED_EXTENSIONS = new Set(["csv", "tsv", "xlsx", "xls"]);

export type FileValidationResult =
  | { ok: true }
  | { ok: false; code: "EXTENSION_NOT_ALLOWED" | "FILE_TOO_LARGE"; message: string };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function validateFile(file: File): FileValidationResult {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: "EXTENSION_NOT_ALLOWED",
      message: `Only .csv, .tsv, .xlsx, and .xls files are supported. Got ".${ext || "no extension"}".`,
    };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The current limit is 25 MB — split it and run again.`,
    };
  }
  return { ok: true };
}
