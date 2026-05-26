import { describe, expect, it } from "vitest";
import { validateJsonField } from "../src/lib/json-validate";

describe("validateJsonField", () => {
  it("returns ok for an empty string (optional field)", () => {
    expect(validateJsonField("")).toEqual({ ok: true, value: null });
  });

  it("returns ok with the parsed object for valid JSON", () => {
    expect(validateJsonField('{"foo": "bar"}')).toEqual({
      ok: true,
      value: { foo: "bar" },
    });
  });

  it("returns error for non-object JSON (arrays, primitives)", () => {
    expect(validateJsonField('"hello"').ok).toBe(false);
    expect(validateJsonField("123").ok).toBe(false);
    expect(validateJsonField("[1, 2]").ok).toBe(false);
  });

  it("returns error for syntactically invalid JSON", () => {
    const result = validateJsonField("{foo: bar}");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not valid json/i);
    }
  });

  it("returns error when payload exceeds 4 KB", () => {
    const giant = JSON.stringify({ padding: "x".repeat(5000) });
    const result = validateJsonField(giant);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/too large/i);
    }
  });
});
