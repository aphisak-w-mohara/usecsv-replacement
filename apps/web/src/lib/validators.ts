import type { ImporterColumn } from "./fuzzy-match";

export type CellValidationResult =
  | { ok: true }
  | { ok: false; severity: "error" | "warning"; message: string };

function err(message: string): CellValidationResult {
  return { ok: false, severity: "error", message };
}

// The 14 usecsv date-format presets, mapped to regex patterns. Captured
// verbatim from usecsv-screenshots/04-validation-formats.png. The keys
// match the dropdown labels shown to admins in the importer config.
//
// NOTE: These regexes validate FORMAT only, not calendar validity.
// "31/02/2024" will pass — Feb has no 31st, but the regex doesn't care.
// This matches usecsv's own behaviour. Calendar-level validation (e.g.
// via Date.parse() or a dedicated date lib) is intentionally deferred.
const DATE_FORMATS: Record<string, RegExp> = {
  "27/03/1998": /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/,
  "27/03/98": /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{2}$/,
  "27-03-1998": /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-\d{4}$/,
  "27-03-98": /^(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-\d{2}$/,
  "27.03.1998": /^(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.\d{4}$/,
  "27.03.98": /^(0[1-9]|[12]\d|3[01])\.(0[1-9]|1[0-2])\.\d{2}$/,
  "03/27/1998": /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/,
  "03/27/98": /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{2}$/,
  "03-27-1998": /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-\d{4}$/,
  "03-27-98": /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-\d{2}$/,
  "03.27.1998": /^(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])\.\d{4}$/,
  "03.27.98": /^(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])\.\d{2}$/,
  "1998-03-27": /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  DATEVALUE: /^\d+$/,
};

const NUMBER_PATTERN = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;
const PHONE_PATTERN = /^[\d\s()[\]\-+.]+$/;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const EMAIL_WITH_DISPLAY_PATTERN = /^([^<]+\s+)?<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/;

export function validateCell(value: string, column: ImporterColumn): CellValidationResult {
  const trimmed = value.trim();
  if (trimmed === "") {
    if (column.value_cannot_be_blank) {
      return err("This value cannot be blank.");
    }
    return { ok: true };
  }

  switch (column.validation_type) {
    case "string":
      return { ok: true };

    case "number":
      return NUMBER_PATTERN.test(trimmed) ? { ok: true } : err("Not a valid number.");

    case "email": {
      const allowDisplay = column.validation_format === "allowDisplayName";
      const pattern = allowDisplay ? EMAIL_WITH_DISPLAY_PATTERN : EMAIL_PATTERN;
      return pattern.test(trimmed) ? { ok: true } : err("Not a valid email address.");
    }

    case "phone":
      return PHONE_PATTERN.test(trimmed) ? { ok: true } : err("Not a valid phone number.");

    case "date": {
      if (!column.validation_format) {
        return err("Date column has no format configured.");
      }
      const pattern = DATE_FORMATS[column.validation_format];
      if (!pattern) {
        return err(`Unknown date format: ${column.validation_format}`);
      }
      return pattern.test(trimmed)
        ? { ok: true }
        : err(`Not a valid date (expected ${column.validation_format}).`);
    }

    case "regex": {
      if (!column.validation_format) {
        return err("Regex column has no pattern configured.");
      }
      try {
        const pattern = new RegExp(column.validation_format);
        return pattern.test(trimmed)
          ? { ok: true }
          : err("Value does not match the expected format.");
      } catch {
        return err("Regex pattern is invalid.");
      }
    }

    case "select": {
      if (!column.validation_format) {
        return err("Select column has no options configured.");
      }
      const options = column.validation_format.split(",").map((s) => s.trim());
      return options.includes(trimmed)
        ? { ok: true }
        : err(`Must be one of: ${options.join(", ")}.`);
    }

    case "boolean": {
      if (!column.validation_format) {
        return err("Boolean column has no template configured.");
      }
      const allowed = column.validation_format.split(",").map((s) => s.trim().toLowerCase());
      return allowed.includes(trimmed.toLowerCase())
        ? { ok: true }
        : err(`Must be ${allowed.join(" or ")}.`);
    }

    default:
      return err(`Unknown validation type: ${String(column.validation_type)}`);
  }
}
