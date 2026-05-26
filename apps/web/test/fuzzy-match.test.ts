import { describe, expect, it } from "vitest";
import {
  suggestColumnMappings,
  type ImporterColumn,
} from "../src/lib/fuzzy-match";

const TENANT_COLUMNS: ImporterColumn[] = [
  {
    id: "col_tenants_first_name",
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
    id: "col_tenants_last_name",
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
    id: "col_tenants_email",
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

describe("suggestColumnMappings", () => {
  it("maps file headers that exactly match a display_name (case-insensitive)", () => {
    const result = suggestColumnMappings(
      ["First name", "Last name", "Customer Email"],
      TENANT_COLUMNS,
    );
    expect(result["First name"]).toBe("first_name");
    expect(result["Last name"]).toBe("last_name");
    expect(result["Customer Email"]).toBe("email");
  });

  it("maps when the file headers exactly match a machine name", () => {
    const result = suggestColumnMappings(
      ["first_name", "last_name", "email"],
      TENANT_COLUMNS,
    );
    expect(result["first_name"]).toBe("first_name");
    expect(result["email"]).toBe("email");
  });

  it("fuzzy-matches similar headers (whitespace + case differences)", () => {
    const result = suggestColumnMappings(
      ["FIRST NAME", "  Last  Name  ", "customer email"],
      TENANT_COLUMNS,
    );
    expect(result["FIRST NAME"]).toBe("first_name");
    expect(result["  Last  Name  "]).toBe("last_name");
    expect(result["customer email"]).toBe("email");
  });

  it("returns __ignore__ for headers with no plausible match", () => {
    const result = suggestColumnMappings(
      ["First name", "Phone", "Notes"],
      TENANT_COLUMNS,
    );
    expect(result["First name"]).toBe("first_name");
    expect(result["Phone"]).toBe("__ignore__");
    expect(result["Notes"]).toBe("__ignore__");
  });

  it("does NOT assign the same importer column to two different file headers", () => {
    const result = suggestColumnMappings(
      ["First name", "firstname"],
      TENANT_COLUMNS,
    );
    const claims = Object.values(result).filter((v) => v === "first_name");
    expect(claims).toHaveLength(1);
    expect(Object.values(result).filter((v) => v === "__ignore__")).toHaveLength(1);
  });

  it("returns __ignore__ for every header when importerColumns is empty", () => {
    const result = suggestColumnMappings(["A", "B"], []);
    expect(result).toEqual({ A: "__ignore__", B: "__ignore__" });
  });
});
