import { describe, expect, it } from "vitest";
import { validateCell } from "../src/lib/validators";
import type { ImporterColumn } from "../src/lib/fuzzy-match";

function col(overrides: Partial<ImporterColumn> = {}): ImporterColumn {
  return {
    id: "col_test",
    name: "test",
    display_name: "Test",
    description: null,
    example: null,
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
    ...overrides,
  };
}

describe("validateCell — blank-cell rule", () => {
  it("rejects empty string when value_cannot_be_blank is true", () => {
    const result = validateCell("", col({ value_cannot_be_blank: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/cannot be blank/i);
  });

  it("accepts empty string when value_cannot_be_blank is false", () => {
    const result = validateCell("", col({ value_cannot_be_blank: false }));
    expect(result.ok).toBe(true);
  });

  it("rejects whitespace-only when value_cannot_be_blank is true", () => {
    expect(validateCell("   ", col()).ok).toBe(false);
  });
});

describe("validateCell — string", () => {
  it("accepts any non-empty string", () => {
    expect(validateCell("anything", col({ validation_type: "string" })).ok).toBe(true);
  });
});

describe("validateCell — number", () => {
  it("accepts plain integers", () => {
    expect(validateCell("42", col({ validation_type: "number" })).ok).toBe(true);
  });

  it("accepts decimals with dot", () => {
    expect(validateCell("3.14", col({ validation_type: "number" })).ok).toBe(true);
  });

  it("accepts numbers with comma thousands separator", () => {
    expect(validateCell("1,234", col({ validation_type: "number" })).ok).toBe(true);
    expect(validateCell("1,234.56", col({ validation_type: "number" })).ok).toBe(true);
  });

  it("accepts negative numbers", () => {
    expect(validateCell("-42", col({ validation_type: "number" })).ok).toBe(true);
  });

  it("rejects non-numeric strings", () => {
    expect(validateCell("abc", col({ validation_type: "number" })).ok).toBe(false);
  });
});

describe("validateCell — email", () => {
  it("accepts a plain email", () => {
    expect(validateCell("alice@example.com", col({ validation_type: "email" })).ok).toBe(true);
  });

  it("rejects strings without @", () => {
    expect(validateCell("alice", col({ validation_type: "email" })).ok).toBe(false);
  });

  it("rejects 'Name <email>' form when allow_display_name is NOT set", () => {
    expect(
      validateCell("Alice Smith <alice@example.com>", col({ validation_type: "email" })).ok,
    ).toBe(false);
  });

  it("accepts 'Name <email>' form when format is 'allowDisplayName'", () => {
    expect(
      validateCell(
        "Alice Smith <alice@example.com>",
        col({ validation_type: "email", validation_format: "allowDisplayName" }),
      ).ok,
    ).toBe(true);
  });
});

describe("validateCell — phone", () => {
  it("accepts plain digits", () => {
    expect(validateCell("1234567890", col({ validation_type: "phone" })).ok).toBe(true);
  });

  it("accepts numbers with formatting symbols ()-+", () => {
    expect(validateCell("+1 (555) 123-4567", col({ validation_type: "phone" })).ok).toBe(true);
  });

  it("rejects letters", () => {
    expect(validateCell("call-me", col({ validation_type: "phone" })).ok).toBe(false);
  });
});

describe("validateCell — date", () => {
  it("accepts DD/MM/YYYY when format is '27/03/1998'", () => {
    expect(
      validateCell("27/03/1998", col({ validation_type: "date", validation_format: "27/03/1998" }))
        .ok,
    ).toBe(true);
  });

  it("accepts YYYY-MM-DD when format is '1998-03-27'", () => {
    expect(
      validateCell("1998-03-27", col({ validation_type: "date", validation_format: "1998-03-27" }))
        .ok,
    ).toBe(true);
  });

  it("rejects DD/MM/YYYY input against YYYY-MM-DD format", () => {
    expect(
      validateCell("27/03/1998", col({ validation_type: "date", validation_format: "1998-03-27" }))
        .ok,
    ).toBe(false);
  });

  it("returns error when validation_format is missing for a date column", () => {
    const result = validateCell("any", col({ validation_type: "date", validation_format: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no.*format/i);
  });

  it("accepts calendar-invalid dates (format-only validation, matches usecsv behaviour)", () => {
    // 31/02/2024 — Feb has no 31st, but the regex only enforces the
    // YYYY/MM/DD shape, not calendar validity. Documented as a known
    // limitation; calendar checks are intentionally deferred.
    expect(
      validateCell("31/02/2024", col({ validation_type: "date", validation_format: "27/03/1998" }))
        .ok,
    ).toBe(true);
  });
});

describe("validateCell — regex", () => {
  it("accepts values matching the format pattern", () => {
    expect(
      validateCell(
        "ABC-123",
        col({ validation_type: "regex", validation_format: "^[A-Z]{3}-\\d{3}$" }),
      ).ok,
    ).toBe(true);
  });

  it("rejects values that don't match", () => {
    expect(
      validateCell(
        "abc-123",
        col({ validation_type: "regex", validation_format: "^[A-Z]{3}-\\d{3}$" }),
      ).ok,
    ).toBe(false);
  });

  it("returns error when validation_format is missing", () => {
    const result = validateCell("x", col({ validation_type: "regex", validation_format: null }));
    expect(result.ok).toBe(false);
  });
});

describe("validateCell — select", () => {
  it("accepts a value present in the comma-separated options", () => {
    expect(
      validateCell(
        "yellow",
        col({ validation_type: "select", validation_format: "red,green,blue,yellow" }),
      ).ok,
    ).toBe(true);
  });

  it("rejects a value not in the options", () => {
    expect(
      validateCell(
        "purple",
        col({ validation_type: "select", validation_format: "red,green,blue" }),
      ).ok,
    ).toBe(false);
  });

  it("is case-sensitive against the options list", () => {
    expect(
      validateCell("Red", col({ validation_type: "select", validation_format: "red,green" })).ok,
    ).toBe(false);
  });
});

describe("validateCell — boolean", () => {
  it("accepts true/false (format 'true,false')", () => {
    expect(
      validateCell("true", col({ validation_type: "boolean", validation_format: "true,false" })).ok,
    ).toBe(true);
    expect(
      validateCell("false", col({ validation_type: "boolean", validation_format: "true,false" }))
        .ok,
    ).toBe(true);
  });

  it("accepts yes/no (format 'yes,no')", () => {
    expect(
      validateCell("yes", col({ validation_type: "boolean", validation_format: "yes,no" })).ok,
    ).toBe(true);
  });

  it("accepts 1/0 (format '1,0')", () => {
    expect(
      validateCell("1", col({ validation_type: "boolean", validation_format: "1,0" })).ok,
    ).toBe(true);
  });

  it("rejects values outside the chosen format pair", () => {
    expect(
      validateCell("yes", col({ validation_type: "boolean", validation_format: "true,false" })).ok,
    ).toBe(false);
  });

  it("is case-insensitive on yes/no and true/false", () => {
    expect(
      validateCell("YES", col({ validation_type: "boolean", validation_format: "yes,no" })).ok,
    ).toBe(true);
    expect(
      validateCell("True", col({ validation_type: "boolean", validation_format: "true,false" })).ok,
    ).toBe(true);
  });
});
