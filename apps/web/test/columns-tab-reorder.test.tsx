import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnsTab } from "../src/components/importers/columns-tab";

const COLS = [
  {
    id: "col_a",
    position: 1,
    name: "alpha",
    display_name: "Alpha",
    description: null,
    example: null,
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
    custom_error_message: null,
  },
  {
    id: "col_b",
    position: 2,
    name: "beta",
    display_name: "Beta",
    description: null,
    example: null,
    must_be_matched: true,
    value_cannot_be_blank: true,
    validation_type: "string",
    validation_format: null,
    custom_error_message: null,
  },
  {
    id: "col_c",
    position: 3,
    name: "gamma",
    display_name: "Gamma",
    description: null,
    example: null,
    must_be_matched: false,
    value_cannot_be_blank: false,
    validation_type: "string",
    validation_format: null,
    custom_error_message: null,
  },
];

beforeEach(() => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    if (url.includes("/columns/order") && method === "PUT") {
      const body = JSON.parse(init!.body as string) as { ordered_ids: string[] };
      const byId = new Map(COLS.map((c) => [c.id, c]));
      const reordered = body.ordered_ids.map((id, i) => ({ ...byId.get(id)!, position: i + 1 }));
      return new Response(JSON.stringify({ importer_id: "imp_x", columns: reordered }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/columns") && method === "GET") {
      return new Response(JSON.stringify({ importer_id: "imp_x", columns: COLS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ColumnsTab — reorder", () => {
  it("disables the up button on the first row and the down button on the last row", async () => {
    render(<ColumnsTab importerId="imp_x" />);
    await waitFor(() => screen.getByText("alpha"));

    expect(screen.getByRole("button", { name: /move alpha up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move alpha down/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /move gamma up/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /move gamma down/i })).toBeDisabled();
  });

  it("clicking Move down on alpha sends a PUT with the swapped ids", async () => {
    render(<ColumnsTab importerId="imp_x" />);
    await waitFor(() => screen.getByText("alpha"));

    fireEvent.click(screen.getByRole("button", { name: /move alpha down/i }));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const put = calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
      expect(put).toBeDefined();
      const body = JSON.parse((put![1] as RequestInit).body as string) as {
        ordered_ids: string[];
      };
      expect(body.ordered_ids).toEqual(["col_b", "col_a", "col_c"]);
    });
  });
});
