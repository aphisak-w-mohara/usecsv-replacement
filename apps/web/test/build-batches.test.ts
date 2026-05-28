import { describe, expect, it } from "vitest";
import { buildBatches } from "../src/lib/build-batches";

// matched is { machine_name: file_header } — the wizard's canonical direction.
const matched = { first_name: "First name", last_name: "Last name", email: "Customer Email" };

describe("buildBatches", () => {
  it("remaps file-header keys to machine names and adds 1-based row numbers", () => {
    const editedRows = [
      { "First name": "Alice", "Last name": "Smith", "Customer Email": "a@b.com", Notes: "ignore" },
    ];
    const result = buildBatches(editedRows, matched, 1000);
    expect(result.total_rows).toBe(1);
    expect(result.batch_count).toBe(1);
    expect(result.batches[0]!.index).toBe(1);
    expect(result.batches[0]!.rows[0]).toEqual({
      row: 1,
      first_name: "Alice",
      last_name: "Smith",
      email: "a@b.com",
    });
    // Unmatched 'Notes' column is dropped from rows[].
    expect(result.batches[0]!.rows[0]).not.toHaveProperty("Notes");
  });

  it("chunks 2500 rows into 3 batches with global row numbering", () => {
    const editedRows = Array.from({ length: 2500 }, (_, i) => ({
      "First name": `F${i}`,
      "Last name": `L${i}`,
      "Customer Email": `u${i}@x.com`,
    }));
    const result = buildBatches(editedRows, matched, 1000);
    expect(result.batch_count).toBe(3);
    expect(result.total_rows).toBe(2500);
    expect(result.batches.map((b) => b.index)).toEqual([1, 2, 3]);
    expect(result.batches[0]!.rows.length).toBe(1000);
    expect(result.batches[2]!.rows.length).toBe(500);
    // batch 3, row 1 is the 2001st source row.
    expect(result.batches[2]!.rows[0]!.row).toBe(2001);
  });
});
