import { describe, expect, it } from "vitest";
import fixture from "../../../captured-payloads/2026-05-26-usecsv-live-webhook.json";
import { buildWebhookPayload } from "../src/lib/webhook-payload";

describe("buildWebhookPayload", () => {
  it("reproduces the captured usecsv body byte-shape (deep equality)", () => {
    const payload = buildWebhookPayload({
      numericId: 274300290,
      importerKey: "82b18e5e-6412-4102-901a-ce3c05d71460",
      fileName: "sample-tenants.csv",
      matchedColumnsMap: {
        email: "Customer Email",
        last_name: "Last name",
        first_name: "First name",
      },
      uploadedFileHeaders: ["First name", "Last name", "Customer Email", "Notes"],
      batchIndex: 1,
      batchCount: 1,
      totalRows: 3,
      user: null,
      metadata: null,
      rows: [
        { row: 1, first_name: "Alice", last_name: "Smith", email: "alice@example.com" },
        { row: 2, first_name: "Bob", last_name: "Jones", email: "bob@example.com" },
        { row: 3, first_name: "Carol", last_name: "Lee", email: "carol.lee@example.com" },
      ],
    });
    expect(payload).toEqual(fixture.body);
  });

  it("keeps user/metadata as null (never undefined) and uploadId as a number", () => {
    const p = buildWebhookPayload({
      numericId: 7,
      importerKey: "k",
      fileName: "f.csv",
      matchedColumnsMap: { a: "A" },
      uploadedFileHeaders: ["A"],
      batchIndex: 2,
      batchCount: 5,
      totalRows: 4321,
      user: null,
      metadata: null,
      rows: [{ row: 1001, a: "x" }],
    });
    expect(p.user).toBeNull();
    expect(p.metadata).toBeNull();
    expect(typeof p.uploadId).toBe("number");
    expect(p.batch).toEqual({ index: 2, count: 5, totalRows: 4321 });
  });
});
