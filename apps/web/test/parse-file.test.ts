import { describe, expect, it } from "vitest";
import { parseFile } from "../src/lib/parse-file";
import { MAX_ROW_COUNT } from "../src/lib/file-validate";

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

const TENANTS_CSV = [
  "First name,Last name,Customer Email,Notes",
  "Alice,Smith,alice@example.com,VIP tenant",
  "Bob,Jones,bob@example.com,Just moved in",
  "Carol,Lee,carol.lee@example.com,",
].join("\n");

const TSV = ["first_name\tlast_name", "Alice\tSmith", "Bob\tJones"].join("\n");

describe("parseFile", () => {
  it("parses a CSV file with the expected headers and rows", async () => {
    const result = await parseFile(csvFile("sample.csv", TENANTS_CSV));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("csv");
    expect(result.headers).toEqual([
      "First name",
      "Last name",
      "Customer Email",
      "Notes",
    ]);
    expect(result.rowCount).toBe(3);
    expect(result.rows[0]).toEqual({
      "First name": "Alice",
      "Last name": "Smith",
      "Customer Email": "alice@example.com",
      Notes: "VIP tenant",
    });
  });

  it("parses a TSV file by detecting the .tsv extension", async () => {
    const result = await parseFile(csvFile("data.tsv", TSV));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("tsv");
    expect(result.headers).toEqual(["first_name", "last_name"]);
    expect(result.rowCount).toBe(2);
  });

  it("rejects unsupported file extensions", async () => {
    const result = await parseFile(csvFile("notes.txt", "anything"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("EXTENSION_NOT_ALLOWED");
  });

  it("rejects files > 25 MB", async () => {
    const big = new Uint8Array(26 * 1024 * 1024);
    const result = await parseFile(
      new File([big], "huge.csv", { type: "text/csv" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects files > 50,000 rows", async () => {
    const rows = ["First name"];
    for (let i = 0; i < MAX_ROW_COUNT + 5; i++) {
      rows.push(`row${i}`);
    }
    const result = await parseFile(csvFile("manyrows.csv", rows.join("\n")));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TOO_MANY_ROWS");
    expect(result.message).toMatch(/50,?000/);
  });

  it("returns EMPTY_FILE when there are no data rows", async () => {
    const result = await parseFile(csvFile("empty.csv", "First name\n"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("EMPTY_FILE");
  });

  it("preserves header order in the file", async () => {
    const csv = "C,A,B\n1,2,3\n";
    const result = await parseFile(csvFile("ordered.csv", csv));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual(["C", "A", "B"]);
  });

  it("returns rows as Record<string,string> — no numeric coercion", async () => {
    const csv = "id,price\nabc,12.50\n";
    const result = await parseFile(csvFile("typed.csv", csv));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toEqual({ id: "abc", price: "12.50" });
  });
});
