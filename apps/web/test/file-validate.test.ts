import { describe, expect, it } from "vitest";
import { validateFile, MAX_FILE_BYTES, MAX_ROW_COUNT } from "../src/lib/file-validate";

function file(name: string, size: number): File {
  // jsdom File constructor lets us synthesize a File with arbitrary size
  // without actually allocating that many bytes.
  const blob = new Blob([new Uint8Array(Math.min(size, 1024))]);
  return new File([blob], name, { type: "" });
}

describe("validateFile", () => {
  it("accepts .csv", () => {
    expect(validateFile(file("data.csv", 1024)).ok).toBe(true);
  });

  it("accepts .tsv, .xlsx, .xls", () => {
    expect(validateFile(file("data.tsv", 1024)).ok).toBe(true);
    expect(validateFile(file("data.xlsx", 1024)).ok).toBe(true);
    expect(validateFile(file("data.xls", 1024)).ok).toBe(true);
  });

  it("rejects unsupported extensions", () => {
    const result = validateFile(file("notes.txt", 1024));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXTENSION_NOT_ALLOWED");
      expect(result.message).toMatch(/csv|tsv|xls/i);
    }
  });

  it("is case-insensitive on extension", () => {
    expect(validateFile(file("data.CSV", 1024)).ok).toBe(true);
    expect(validateFile(file("data.XLSX", 1024)).ok).toBe(true);
  });

  it("rejects files larger than MAX_FILE_BYTES", () => {
    const result = validateFile(file("huge.csv", MAX_FILE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FILE_TOO_LARGE");
    }
  });

  it("accepts files exactly at MAX_FILE_BYTES", () => {
    expect(validateFile(file("at-cap.csv", MAX_FILE_BYTES)).ok).toBe(true);
  });

  it("exposes the row cap as MAX_ROW_COUNT = 50000", () => {
    expect(MAX_ROW_COUNT).toBe(50_000);
  });
});
