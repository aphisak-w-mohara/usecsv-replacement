# Story #5 — Read-only Review Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or build to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Step 3a of the upload wizard — a virtualized read-only grid that runs per-cell validation against the importer's column schema for up to 50,000 rows, surfaces a summary of errors + warnings, lets the user filter to errors only, and respects the two importer-environment flags that govern submission gating.

**Architecture:** All validation lives in a single pure-function dispatcher `validateCell(value, column)` keyed off `importer_columns.validation_type`. The grid uses **TanStack Table** as the data model and **TanStack Virtual** to render only the visible rows — 50k rows yields ~30 DOM rows on screen at any time. Validation runs once on mount, cached in a `Map<number, Map<string, ValidationResult>>` keyed by `(rowIndex, machineColumnName)` for O(1) lookup during render and filter operations. Story #5 is **read-only** — inline editing lands in Story #6.

**Tech Stack:** Already in place from earlier stories. New this story: **`@tanstack/react-table`** + **`@tanstack/react-virtual`**.

**Maps to GitHub Issue:** [#5 — Read-only review grid with per-cell validation](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/5)

**Parent Epic:** [#1 — Upload Wizard](https://github.com/aphisak-w-mohara/usecsv-replacement/issues/1)

**Spec references:**
- [`prds/prd-feature-upload-wizard.md`](../../../prds/prd-feature-upload-wizard.md) — Story 4a in §5.4
- [`docs/superpowers/specs/2026-05-26-usecsv-clone-design.md`](../../superpowers/specs/2026-05-26-usecsv-clone-design.md) — Upload Wizard step 3 in §11
- [`usecsv-screenshots/04-validation-formats.png`](../../../usecsv-screenshots/04-validation-formats.png) — the 14 date-format presets usecsv supports, verbatim

---

## File Structure

```
evo-usecsv/
└── apps/web/
    ├── package.json                                       [M] add @tanstack/react-table + @tanstack/react-virtual
    ├── src/
    │   ├── lib/
    │   │   └── validators.ts                              [N] dispatcher + 8 format validators + DATE_FORMATS table
    │   └── components/upload-wizard/
    │       └── step-review-grid.tsx                       [N] Step 3a virtualized read-only grid
    ├── src/routes/_authed/admin/
    │   └── importers.$id.upload.tsx                       [M] Step 2 → Step 3 transition + activeStep widening
    └── test/
        ├── validators.test.ts                             [N] ~25 unit tests across 8 formats
        └── step-review-grid.test.tsx                      [N] 7 component tests
```

**Design notes:**
- `validators.ts` is pure. Each format is a tiny function. They dispatch through `validateCell(value, column)` which is the only function the component imports.
- `step-review-grid.tsx` owns its own validation cache. The route doesn't need to compute or pass it.
- The two importer-environment flags (`filter_invalid_rows`, `disable_importing_all_data_if_there_are_invalid_rows`) are passed as plain boolean props for now and **default to `false` in the route** — there's no API to fetch them yet. A follow-up Epic (Importer admin) will wire them up. The component **implements the logic** so when the wiring lands, no component changes are needed.
- Inline editing is **out of scope** — Story #6 will extend `step-review-grid.tsx` to add the edit affordance.

---

## Shared types

```ts
// In apps/web/src/lib/validators.ts

import type { ImporterColumn } from "./fuzzy-match";

export type CellValidationResult =
  | { ok: true }
  | { ok: false; severity: "error" | "warning"; message: string };

// Optional context for validators that need column-level config beyond the type
// (e.g. date format strings, regex patterns, select option lists, allow_display_name).
export type ValidateOptions = {
  // Optional, only used by date / regex / select / email-with-allowDisplayName
  // For date: one of DATE_FORMAT_KEYS (e.g. "27/03/1998", "DATEVALUE")
  // For regex: a regex string
  // For select: a comma-separated string of allowed options
  // For email with allow_display_name: "allowDisplayName"
  format?: string | null;
  valueCannotBeBlank?: boolean;
};

// Main dispatcher — only public API the component uses.
export function validateCell(
  value: string,
  column: ImporterColumn,
): CellValidationResult;
```

---

# Phase 1 — Dependencies + validators (Tasks 1–2)

### Task 1: Install TanStack Table + TanStack Virtual

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add deps**

Edit `apps/web/package.json` — add to `dependencies` (alphabetical placement):

```json
    "@tanstack/react-table": "^8.20.0",
    "@tanstack/react-virtual": "^3.10.0",
```

- [ ] **Step 2: Install + verify build**

Run from repo root: `pnpm install`
Then: `pnpm --filter @evo-csv/web build`
Expected: build passes. Record resolved versions.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @tanstack/react-table and react-virtual"
```

---

### Task 2: validators.ts — 8-format dispatcher (TDD red→green)

**Files:**
- Create: `apps/web/src/lib/validators.ts`
- Create: `apps/web/test/validators.test.ts`

The validator is one pure function — `validateCell(value, column)` — that dispatches on `column.validation_type` into 8 internal validators. Each returns `{ ok: true }` or `{ ok: false, severity, message }`. The `value_cannot_be_blank` flag is enforced before format-specific checks.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/validators.test.ts`:

```ts
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
      validateCell(
        "27/03/1998",
        col({ validation_type: "date", validation_format: "27/03/1998" }),
      ).ok,
    ).toBe(true);
  });

  it("accepts YYYY-MM-DD when format is '1998-03-27'", () => {
    expect(
      validateCell(
        "1998-03-27",
        col({ validation_type: "date", validation_format: "1998-03-27" }),
      ).ok,
    ).toBe(true);
  });

  it("rejects DD/MM/YYYY input against YYYY-MM-DD format", () => {
    expect(
      validateCell(
        "27/03/1998",
        col({ validation_type: "date", validation_format: "1998-03-27" }),
      ).ok,
    ).toBe(false);
  });

  it("returns error when validation_format is missing for a date column", () => {
    const result = validateCell(
      "any",
      col({ validation_type: "date", validation_format: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no.*format/i);
  });
});

describe("validateCell — regex", () => {
  it("accepts values matching the format pattern", () => {
    expect(
      validateCell("ABC-123", col({ validation_type: "regex", validation_format: "^[A-Z]{3}-\\d{3}$" })).ok,
    ).toBe(true);
  });

  it("rejects values that don't match", () => {
    expect(
      validateCell("abc-123", col({ validation_type: "regex", validation_format: "^[A-Z]{3}-\\d{3}$" })).ok,
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
      validateCell("false", col({ validation_type: "boolean", validation_format: "true,false" })).ok,
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
```

- [ ] **Step 2: Stub the module**

Create `apps/web/src/lib/validators.ts`:

```ts
import type { ImporterColumn } from "./fuzzy-match";

export type CellValidationResult =
  | { ok: true }
  | { ok: false; severity: "error" | "warning"; message: string };

export function validateCell(
  _value: string,
  _column: ImporterColumn,
): CellValidationResult {
  throw new Error("not implemented");
}
```

- [ ] **Step 3: Run + verify FAIL**

Run: `pnpm --filter @evo-csv/web test validators`
Expected: 28 FAILS with "not implemented".

- [ ] **Step 4: Commit (RED)**

```bash
git add apps/web/src/lib/validators.ts apps/web/test/validators.test.ts
git commit -m "test(web): add failing tests for validateCell (8 formats)"
```

- [ ] **Step 5: Implement validators**

Replace `apps/web/src/lib/validators.ts`:

```ts
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
  // DATEVALUE is Excel's serial-date format (integer days since 1900-01-01).
  // Accept any non-negative integer.
  DATEVALUE: /^\d+$/,
};

const NUMBER_PATTERN = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;
const PHONE_PATTERN = /^[\d\s()\[\]\-+.]+$/;
// RFC 5322 lite — same shape usecsv accepts for plain emails.
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// "Display Name <email@host>" — only used when format is "allowDisplayName".
const EMAIL_WITH_DISPLAY_PATTERN =
  /^([^<]+\s+)?<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/;

export function validateCell(
  value: string,
  column: ImporterColumn,
): CellValidationResult {
  // Blank-cell rule runs first; format checks only matter for non-blank values.
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
      return pattern.test(trimmed) ? { ok: true } : err(`Not a valid date (expected ${column.validation_format}).`);
    }

    case "regex": {
      if (!column.validation_format) {
        return err("Regex column has no pattern configured.");
      }
      try {
        const pattern = new RegExp(column.validation_format);
        return pattern.test(trimmed) ? { ok: true } : err("Value does not match the expected format.");
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
      // TypeScript guarantees exhaustiveness, but be defensive.
      return err(`Unknown validation type: ${String(column.validation_type)}`);
  }
}
```

- [ ] **Step 6: Run + verify PASS**

Run: `pnpm --filter @evo-csv/web test validators`
Expected: 28 PASS.

Full suite check:
Run: `pnpm --filter @evo-csv/web test`
Expected: 75 tests pass (47 prior + 28 new).

- [ ] **Step 7: Run pnpm format**

- [ ] **Step 8: Commit (GREEN)**

```bash
git add apps/web/src/lib/validators.ts
git commit -m "feat(web): implement validateCell with all 8 importer formats

Single pure-function dispatcher on column.validation_type. Each
format is a small internal validator; DATE_FORMATS holds the 14
usecsv presets (captured verbatim from the live admin UI). The
blank-cell rule runs before format checks. Email defaults to plain
RFC 5322 lite; admin opts in to display-name form via
validation_format='allowDisplayName' on the column."
```

---

# Phase 2 — UI + integration (Tasks 3–4)

### Task 3: StepReviewGrid component (TDD red→green)

**Files:**
- Create: `apps/web/src/components/upload-wizard/step-review-grid.tsx`
- Create: `apps/web/test/step-review-grid.test.tsx`

The component:
- Props: `fileHeaders`, `rows`, `importerColumns`, `matched` (`{ machine_name: file_header }`), `filterInvalidRows`, `disableIfAnyInvalid`, `onConfirmed`, `onBack`
- On mount, runs `validateCell` for every cell across every mapped column. Caches results in a `Map<rowIndex, Map<machineColumnName, CellValidationResult>>`.
- Renders a virtualized grid using `useReactTable` + `useVirtualizer`.
- Cells with errors get red bg + ⚠ icon + `title` tooltip with the validation message.
- Above the grid: summary chip `<total> rows · <error_count> errors · <warning_count> warnings` and a "Show only errors" toggle.
- When `disableIfAnyInvalid` is true AND `error_count > 0`: red banner blocks Next.
- When `filterInvalidRows` is true: footer reads "X rows will be excluded due to errors."
- On Next: calls `onConfirmed()` (no payload for Story #5 — Story #6 will revisit).

Note: the 50k-row / 200ms perf target is verified at smoke time, not in unit tests. Vitest can't reliably measure render time in jsdom.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/step-review-grid.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StepReviewGrid } from "../src/components/upload-wizard/step-review-grid";
import type { ImporterColumn } from "../src/lib/fuzzy-match";

const TENANT_COLUMNS: ImporterColumn[] = [
  {
    id: "col_first_name",
    name: "first_name",
    display_name: "First name",
    description: null,
    example: "Alice",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_last_name",
    name: "last_name",
    display_name: "Last name",
    description: null,
    example: "Smith",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
  },
  {
    id: "col_email",
    name: "email",
    display_name: "Customer Email",
    description: null,
    example: "alice@example.com",
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "email",
    validation_format: null,
  },
];

const FILE_HEADERS = ["First name", "Last name", "Customer Email"];
const MATCHED = {
  first_name: "First name",
  last_name: "Last name",
  email: "Customer Email",
};

const GOOD_ROWS = [
  { "First name": "Alice", "Last name": "Smith", "Customer Email": "alice@example.com" },
  { "First name": "Bob", "Last name": "Jones", "Customer Email": "bob@example.com" },
  { "First name": "Carol", "Last name": "Lee", "Customer Email": "carol@example.com" },
];

const ONE_BAD_EMAIL_ROW = [
  { "First name": "Alice", "Last name": "Smith", "Customer Email": "alice@example.com" },
  { "First name": "Bob", "Last name": "Jones", "Customer Email": "not-an-email" },
  { "First name": "Carol", "Last name": "Lee", "Customer Email": "carol@example.com" },
];

function renderGrid(overrides: Partial<Parameters<typeof StepReviewGrid>[0]> = {}) {
  return render(
    <StepReviewGrid
      fileHeaders={FILE_HEADERS}
      rows={GOOD_ROWS}
      importerColumns={TENANT_COLUMNS}
      matched={MATCHED}
      filterInvalidRows={false}
      disableIfAnyInvalid={false}
      onConfirmed={() => {}}
      onBack={() => {}}
      {...overrides}
    />,
  );
}

describe("StepReviewGrid", () => {
  it("renders the summary with zero errors when all cells are valid", () => {
    renderGrid();
    expect(screen.getByText(/3 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/0 errors/i)).toBeInTheDocument();
  });

  it("flags the bad email cell and surfaces its message via title attribute", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW });
    expect(screen.getByText(/3 rows/i)).toBeInTheDocument();
    expect(screen.getByText(/1 error/i)).toBeInTheDocument();
    // The bad cell renders with title=<message>
    const badCell = screen.getByTitle(/not a valid email address/i);
    expect(badCell).toBeInTheDocument();
    expect(badCell.textContent).toContain("not-an-email");
  });

  it("'Show only errors' filter reduces the visible row count", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW });
    // Initially all 3 row numbers are visible
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /show only errors/i }));

    // After filter: only row 2 (the bad email) is visible
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("blocks Next when disableIfAnyInvalid is true and any errors exist", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW, disableIfAnyInvalid: true });
    expect(screen.getByText(/imports with errors are blocked/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it("does NOT block Next when disableIfAnyInvalid is false (default)", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW, disableIfAnyInvalid: false });
    expect(screen.queryByText(/imports with errors are blocked/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeEnabled();
  });

  it("shows 'X rows will be excluded' footer when filterInvalidRows is true and errors exist", () => {
    renderGrid({ rows: ONE_BAD_EMAIL_ROW, filterInvalidRows: true });
    // 1 row has an error → 1 row will be excluded
    expect(screen.getByText(/1 row will be excluded/i)).toBeInTheDocument();
  });

  it("calls onConfirmed when Next is clicked", () => {
    const onConfirmed = vi.fn();
    renderGrid({ onConfirmed });
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Stub the component**

Create `apps/web/src/components/upload-wizard/step-review-grid.tsx`:

```tsx
import type { ImporterColumn } from "../../lib/fuzzy-match";

export type StepReviewGridProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  matched: Record<string, string>;
  filterInvalidRows: boolean;
  disableIfAnyInvalid: boolean;
  onConfirmed: () => void;
  onBack: () => void;
};

export function StepReviewGrid(_props: StepReviewGridProps) {
  return null;
}
```

- [ ] **Step 3: Run + verify FAIL**

Run: `pnpm --filter @evo-csv/web test step-review-grid`
Expected: 7 FAILS — stub renders nothing.

- [ ] **Step 4: Commit (RED)**

```bash
git add apps/web/src/components/upload-wizard/step-review-grid.tsx apps/web/test/step-review-grid.test.tsx
git commit -m "test(web): add failing tests for StepReviewGrid"
```

- [ ] **Step 5: Implement the component**

Replace `apps/web/src/components/upload-wizard/step-review-grid.tsx`:

```tsx
import { useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ImporterColumn } from "../../lib/fuzzy-match";
import { validateCell, type CellValidationResult } from "../../lib/validators";

export type StepReviewGridProps = {
  fileHeaders: string[];
  rows: Record<string, string>[];
  importerColumns: ImporterColumn[];
  matched: Record<string, string>; // { machine_name: file_header }
  filterInvalidRows: boolean;
  disableIfAnyInvalid: boolean;
  onConfirmed: () => void;
  onBack: () => void;
};

type ValidationCache = Map<number, Map<string, CellValidationResult>>;

type RowWithMeta = {
  __rowIndex: number; // 1-based source row number, shown in the first column
  __hasError: boolean;
  __original: Record<string, string>;
};

export function StepReviewGrid({
  fileHeaders: _fileHeaders,
  rows,
  importerColumns,
  matched,
  filterInvalidRows,
  disableIfAnyInvalid,
  onConfirmed,
  onBack,
}: StepReviewGridProps) {
  // Validate every mapped cell once at mount. Cached for the lifetime of
  // the component — Story #6's inline editing will mutate this map in place.
  const { cache, errorCount, warningCount, errorRowIndices } = useMemo(() => {
    const cache: ValidationCache = new Map();
    const errorRowSet = new Set<number>();
    let errorCount = 0;
    let warningCount = 0;

    rows.forEach((row, rowIdx) => {
      const cellCache = new Map<string, CellValidationResult>();
      for (const column of importerColumns) {
        const fileHeader = matched[column.name];
        if (!fileHeader) continue; // column not mapped — skip validation
        const value = row[fileHeader] ?? "";
        const result = validateCell(value, column);
        cellCache.set(column.name, result);
        if (!result.ok) {
          if (result.severity === "error") {
            errorCount++;
            errorRowSet.add(rowIdx);
          } else {
            warningCount++;
          }
        }
      }
      cache.set(rowIdx, cellCache);
    });

    return { cache, errorCount, warningCount, errorRowIndices: errorRowSet };
  }, [rows, importerColumns, matched]);

  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  // Build the data the table renders — apply the "show only errors" filter
  // by slicing the original rows array into a derived list.
  const tableRows: RowWithMeta[] = useMemo(() => {
    const result: RowWithMeta[] = [];
    rows.forEach((row, rowIdx) => {
      const hasError = errorRowIndices.has(rowIdx);
      if (showOnlyErrors && !hasError) return;
      result.push({
        __rowIndex: rowIdx + 1,
        __hasError: hasError,
        __original: row,
      });
    });
    return result;
  }, [rows, errorRowIndices, showOnlyErrors]);

  // Only render the mapped columns (in importer-column position order)
  // — unmatched file columns are skipped per the design spec.
  const mappedColumns = useMemo(
    () => importerColumns.filter((c) => matched[c.name]),
    [importerColumns, matched],
  );

  const columns: ColumnDef<RowWithMeta>[] = useMemo(() => {
    const cols: ColumnDef<RowWithMeta>[] = [
      {
        id: "__rowIndex",
        header: "#",
        size: 60,
        cell: (info) => (
          <span className="text-slate-400">{info.row.original.__rowIndex}</span>
        ),
      },
    ];
    for (const col of mappedColumns) {
      cols.push({
        id: col.name,
        header: col.display_name,
        size: 160,
        accessorFn: (row) => row.__original[matched[col.name]!] ?? "",
        cell: (info) => {
          const rowIdx = info.row.original.__rowIndex - 1;
          const result = cache.get(rowIdx)?.get(col.name);
          const value = info.getValue() as string;
          const isError = result && !result.ok && result.severity === "error";
          const isWarn = result && !result.ok && result.severity === "warning";
          return (
            <span
              title={result && !result.ok ? result.message : undefined}
              className={
                isError
                  ? "block bg-red-50 px-2 text-red-900"
                  : isWarn
                    ? "block bg-yellow-50 px-2 text-yellow-900"
                    : "block px-2"
              }
            >
              {isError ? "⚠ " : ""}
              {value}
            </span>
          );
        },
      });
    }
    return cols;
  }, [mappedColumns, matched, cache]);

  const table = useReactTable({
    data: tableRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  });

  const blockedByInvalidGate = disableIfAnyInvalid && errorCount > 0;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; submit</h2>
        <p className="text-sm text-slate-600">
          Each mapped cell has been validated against your importer schema.
          Errors highlighted in red — fix them later in Story #6.
        </p>
      </header>

      <div className="flex items-center gap-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        <span>
          <strong>{rows.length.toLocaleString("en-US")}</strong> rows
        </span>
        <span>·</span>
        <span className={errorCount > 0 ? "text-red-700" : "text-slate-600"}>
          <strong>{errorCount}</strong> error{errorCount === 1 ? "" : "s"}
        </span>
        <span>·</span>
        <span className={warningCount > 0 ? "text-yellow-700" : "text-slate-600"}>
          <strong>{warningCount}</strong> warning{warningCount === 1 ? "" : "s"}
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showOnlyErrors}
            onChange={(e) => setShowOnlyErrors(e.target.checked)}
          />
          Show only errors
        </label>
      </div>

      {blockedByInvalidGate && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Imports with errors are blocked for this importer — fix all errors to continue.
        </div>
      )}

      <div
        ref={parentRef}
        className="h-[480px] overflow-auto rounded-md border border-slate-200"
      >
        <table className="min-w-full text-xs" style={{ width: "100%" }}>
          <thead className="sticky top-0 bg-slate-100">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    style={{ width: header.column.getSize() }}
                    className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = table.getRowModel().rows[virtualRow.index]!;
              return (
                <tr
                  key={row.id}
                  style={{ height: `${virtualRow.size}px` }}
                  className="border-b border-slate-100"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="p-0"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filterInvalidRows && errorCount > 0 && (
        <p className="text-xs text-slate-500">
          {errorRowIndices.size} row{errorRowIndices.size === 1 ? "" : "s"} will be excluded due to errors.
        </p>
      )}

      {tableRows.length === 0 && showOnlyErrors && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          🎉 No errors. Untick "Show only errors" to see all rows.
        </p>
      )}

      <footer className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirmed}
          disabled={blockedByInvalidGate}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Next
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 6: Run + verify PASS**

Run: `pnpm --filter @evo-csv/web test step-review-grid`
Expected: 7 PASS.

If a test fails on `getByText(/3 rows/i)` because the summary chip text is structured across multiple text nodes, the test uses partial-text matching which Testing Library handles correctly — it should still find a substring match within an element.

If "filter reduces visible row count" fails because virtualization isn't rendering all 3 rows initially in jsdom (jsdom has no layout, so `parentRef.current` is null-ish until layout pass), check whether the virtualizer renders rows synchronously or via `useEffect`. TanStack Virtual relies on `getBoundingClientRect`, which jsdom returns as all-zero. To work around: pass a small fixed estimate AND the test environment will need to render at least the first few rows because `getVirtualItems()` falls back to overscan + estimate when measurement isn't possible. If 3 rows still don't appear, increase the overscan or fall back to a non-virtualized fallback when `tableRows.length` is small (e.g., `< 100`). This is acceptable since the perf concern is only at 50k+ rows.

Full suite check:
Run: `pnpm --filter @evo-csv/web test`
Expected: 82 tests pass (75 prior + 7 new).

- [ ] **Step 7: Run pnpm format**

- [ ] **Step 8: Commit (GREEN)**

```bash
git add apps/web/src/components/upload-wizard/step-review-grid.tsx
git commit -m "feat(web): implement read-only StepReviewGrid (Story #5)

TanStack Table + TanStack Virtual handle the data model and
windowing. Per-cell validation runs once on mount via validateCell
from lib/validators.ts and is cached in a Map<rowIndex, Map<col,
result>> for O(1) render lookup. Summary chip shows row + error +
warning counts. 'Show only errors' filter, filter_invalid_rows
footer, and disable_importing_all_data gate are all implemented.
Inline editing comes in Story #6."
```

---

### Task 4: Route integration + E2E smoke

**Files:**
- Modify: `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`

The route adds Step 3 to the wizard. Widens `activeStep` from `0 | 1 | 2` to `0 | 1 | 2 | 3` and replaces the `TODO(Story #5)` in `handleMatched` with `setActiveStep(3)`. Step 3 renders `StepReviewGrid` once `state.parsed` + `state.matched` + `importerColumns` are all available. The two importer-environment flags (`filterInvalidRows`, `disableIfAnyInvalid`) are hard-coded to `false` for now — there's no API to fetch them yet.

- [ ] **Step 1: Update the route**

Replace `apps/web/src/routes/_authed/admin/importers.$id.upload.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  StepContext,
  type StepContextSubmit,
} from "../../../components/upload-wizard/step-context";
import { StepMatchColumns } from "../../../components/upload-wizard/step-match-columns";
import { StepReviewGrid } from "../../../components/upload-wizard/step-review-grid";
import { StepUploadFile } from "../../../components/upload-wizard/step-upload-file";
import { WizardShell } from "../../../components/upload-wizard/wizard-shell";
import { api } from "../../../lib/api";
import type { ImporterColumn } from "../../../lib/fuzzy-match";
import type { ParseSuccess } from "../../../lib/parse-file";

export const Route = createFileRoute("/_authed/admin/importers/$id/upload")({
  component: UploadWizardRoute,
});

type WizardState = {
  context: StepContextSubmit | null;
  parsed: ParseSuccess | null;
  matched: Record<string, string> | null;
  reviewed: boolean;
};

function UploadWizardRoute() {
  const { id } = Route.useParams();
  const [activeStep, setActiveStep] = useState<0 | 1 | 2 | 3>(0);
  const [state, setState] = useState<WizardState>({
    context: null,
    parsed: null,
    matched: null,
    reviewed: false,
  });
  const [importerColumns, setImporterColumns] = useState<ImporterColumn[] | null>(null);
  const [columnsError, setColumnsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setColumnsError(null);

    async function load() {
      try {
        const res = await api.api.importers[":importer_id"].columns.$get({
          param: { importer_id: id },
        });
        if (!res.ok) throw new Error(`Failed to fetch columns: ${res.status}`);
        const data = await res.json();
        if (!cancelled) setImporterColumns(data.columns);
      } catch (err) {
        if (!cancelled) {
          setColumnsError(err instanceof Error ? err.message : "Unknown error");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function handleContextSubmit(context: StepContextSubmit) {
    setState((s) => ({ ...s, context }));
    setActiveStep(1);
  }

  function handleFileParsed(parsed: ParseSuccess) {
    setState((s) => ({ ...s, parsed }));
    setActiveStep(2);
  }

  function handleMatched(matched: Record<string, string>) {
    setState((s) => ({ ...s, matched }));
    setActiveStep(3);
  }

  function handleReviewed() {
    setState((s) => {
      // TODO(Story #6/#7): Story #6 will add inline editing on top of this
      // grid; Story #7 will replace this with the actual submit + batch
      // dispatch using s.context + s.parsed + s.matched.
      console.info("[wizard] step 3 -> step 4", {
        context: s.context,
        parsed: s.parsed,
        matched: s.matched,
      });
      return { ...s, reviewed: true };
    });
  }

  return (
    <WizardShell activeStep={activeStep}>
      <p className="mb-4 text-xs text-slate-500">Importer: {id}</p>

      {activeStep === 0 && <StepContext onSubmit={handleContextSubmit} />}

      {activeStep === 1 && (
        <StepUploadFile onParsed={handleFileParsed} onBack={() => setActiveStep(0)} />
      )}

      {activeStep === 2 && state.parsed && (
        <>
          {columnsError && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn't load importer columns: {columnsError}
            </div>
          )}
          {!importerColumns && !columnsError && (
            <p className="text-sm text-slate-500">Loading importer columns…</p>
          )}
          {importerColumns && (
            <StepMatchColumns
              fileHeaders={state.parsed.headers}
              rows={state.parsed.rows}
              importerColumns={importerColumns}
              onMatched={handleMatched}
              onBack={() => setActiveStep(1)}
            />
          )}
        </>
      )}

      {activeStep === 3 && state.parsed && state.matched && importerColumns && (
        <StepReviewGrid
          fileHeaders={state.parsed.headers}
          rows={state.parsed.rows}
          importerColumns={importerColumns}
          matched={state.matched}
          filterInvalidRows={false}
          disableIfAnyInvalid={false}
          onConfirmed={handleReviewed}
          onBack={() => setActiveStep(2)}
        />
      )}

      {state.reviewed && (
        <p className="mt-4 text-xs text-slate-500">
          Step 3 captured. Steps 4-5 (inline edit + submit) land in Stories #6 + #7.
        </p>
      )}
    </WizardShell>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter @evo-csv/web build`
Expected: `tsc --noEmit && vite build` passes.

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: 20 worker + 82 web = **102 tests** pass.

- [ ] **Step 4: Curl-driven smoke**

Start both servers:
```bash
pnpm dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
sleep 8
```

Sanity check:
```bash
curl -s -o /dev/null -w "worker: %{http_code}\n" http://localhost:8787/api/health
curl -s -o /dev/null -w "web: %{http_code}\n" http://localhost:5173/
```
Expected: both `200`.

For the manual browser smoke (not automatable from a subagent):

1. `http://localhost:5173/admin/importers/imp_tenants/upload`
2. Step 0 → empty → Next
3. Step 1 → drop `sample-tenants.csv` → Next
4. Step 2 → all required matched (auto) → Next
5. Step 3 should render the grid with:
   - 3 rows visible
   - Summary chip: "3 rows · 0 errors · 0 warnings"
   - All cells green (no error highlights)
   - Next button enabled
6. Click Next → DevTools console: `[wizard] step 3 -> step 4` with the full context+parsed+matched payload
7. "Step 3 captured. Steps 4-5 (inline edit + submit) land in Stories #6 + #7." appears

Perf spot-check (manual): inflate `sample-tenants.csv` to ~10k rows in a scratch file (e.g., `awk 'NR==1; NR > 1 {for(i=0;i<10000;i++) print}' sample-tenants.csv > /tmp/big-tenants.csv` ), drop that — initial paint should still be near-instant. (The 50k case is the perf target; 10k is a sanity check that virtualization is actually engaging.)

Cleanup:
```bash
kill $DEV_PID 2>/dev/null
pkill -f "wrangler.*dev" 2>/dev/null
pkill -f "vite/bin/vite" 2>/dev/null
sleep 1
```

- [ ] **Step 5: Run pnpm format**

- [ ] **Step 6: Commit + push**

```bash
git add apps/web/src/routes/_authed/admin/importers.$id.upload.tsx
git commit -m "feat(web): wire Step 2 -> Step 3 transition for review grid

Widens activeStep to 0|1|2|3, adds StepReviewGrid mount when
parsed + matched + importerColumns are all loaded. The two
importer-environment flags (filterInvalidRows, disableIfAnyInvalid)
are hard-coded to false — there's no API to fetch them yet; a
follow-up Epic (Importer admin) will wire them up. The component
already implements the logic so when the wiring lands no
component change is needed."
git push -u origin feature/5-review-grid
```

---

## Self-review

Checking against PRD-002 §5.4 (Story 4a — "Read-only review grid with per-cell validation"):

| AC | Task |
|---|---|
| 1. Grid renders 50k rows smoothly (<200ms initial paint, 60fps scroll) | Task 3 (TanStack Virtual + estimateSize=30 + overscan=10). **Perf verification is manual at smoke time** — call out explicitly in the smoke step. |
| 2. Per-cell validation correct for all 8 formats | Task 2 (28 unit tests covering all 8 formats + the blank-cell rule) |
| 3. Error/warning cells visually distinct with icon + tooltip | Task 3 (red/yellow bg + `⚠` prefix + `title` attribute). Tested via `getByTitle`. |
| 4. Summary chip shows rows · errors · warnings, updates on every edit | Task 3 (chip rendered from `useMemo`-computed counts). "Updates on every edit" is Story #6's concern — for Story #5 the counts are immutable once computed. |
| 5. "Show only errors" filter works | Task 3 + tested |
| 6. `disable_importing_all_data_if_there_are_invalid_rows` blocks Next | Task 3 + tested |
| 7. `filter_invalid_rows` shows footer count | Task 3 + tested |

**Partial AC noted:**
- Perf target is not unit-testable; smoke verification only. Documented in T3 step 6 and T4 step 4.
- "Updates on every edit" portion of AC 4 is Story #6's concern; this story is read-only. Explicitly out of scope.
- `filterInvalidRows` + `disableIfAnyInvalid` are passed as `false` in the route — no API to fetch the importer-environment config yet. Component logic is complete; data wiring is a future Epic.

**No placeholders.** All steps include actual code or commands.

**Type consistency:** `CellValidationResult` defined once in `validators.ts`, imported by `step-review-grid.tsx`. `ImporterColumn` reused from `fuzzy-match.ts`. `RowWithMeta` is internal to the component. `Record<string, string>` for `matched` matches Story #4's output exactly.

---

## Execution

**Plan complete and saved to `docs/moai/plans/2026-05-26-story-5-review-grid.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — same pattern that shipped Stories #2–#4.

**2. Inline Execution** — execute with `build`, batched.

**Which approach?**
