import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
];

function setupFetch(deleteResponse: Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    if (url.endsWith("/columns") && method === "GET") {
      return new Response(JSON.stringify({ importer_id: "imp_x", columns: COLS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/columns/col_a") && method === "DELETE") {
      return deleteResponse.clone();
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ColumnsTab — delete", () => {
  beforeEach(() => {
    setupFetch(new Response(null, { status: 204 }));
  });

  it("removes the column on a successful DELETE", async () => {
    render(<ColumnsTab importerId="imp_x" />);
    await waitFor(() => screen.getByText("alpha"));

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /remove column/i }));

    await waitFor(() => {
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    });
  });
});

describe("ColumnsTab — delete failure", () => {
  beforeEach(() => {
    setupFetch(
      new Response(JSON.stringify({ error: "Database error deleting column" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("keeps the column visible and surfaces an inline error when DELETE fails", async () => {
    render(<ColumnsTab importerId="imp_x" />);
    await waitFor(() => screen.getByText("alpha"));

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /remove column/i }));

    // The dialog stays open with a visible error; the column row remains.
    await waitFor(() => {
      expect(within(dialog).getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
  });
});
