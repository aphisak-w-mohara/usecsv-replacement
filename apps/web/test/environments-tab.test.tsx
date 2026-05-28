import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentsTab } from "../src/components/importers/environments-tab";

const ENVS = [
  {
    env_id: "env_evo_staging",
    env_slug: "staging",
    env_name: "Staging",
    is_default: true,
    configured: true,
    importer_environment: {
      id: "impenv_x",
      key: "abc-key-123",
      webhook_url: "https://example.com/old",
      batch_size: 1000,
      filter_invalid_rows: false,
      include_unmatched_columns: false,
      webhook_signing_enabled: false,
      secret_set: false,
    },
  },
  {
    env_id: "env_evo_prod",
    env_slug: "production",
    env_name: "Production",
    is_default: false,
    configured: false,
    importer_environment: null,
  },
];

let putBodies: unknown[];

beforeEach(() => {
  putBodies = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    if (url.endsWith("/environments") && method === "GET") {
      return new Response(JSON.stringify({ environments: ENVS }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/environments/") && method === "PUT") {
      const body = JSON.parse(init!.body as string);
      putBodies.push({ url, body });
      const envId = url.split("/environments/")[1]!;
      return new Response(
        JSON.stringify({
          importer_environment: {
            id: "impenv_x",
            key: "abc-key-123",
            webhook_url: body.webhook_url,
            batch_size: body.batch_size ?? 1000,
            filter_invalid_rows: !!body.filter_invalid_rows,
            include_unmatched_columns: !!body.include_unmatched_columns,
            webhook_signing_enabled: false,
            secret_set: false,
          },
          _env: envId,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EnvironmentsTab", () => {
  it("renders a tab per env and pre-fills the form for the configured env", async () => {
    render(<EnvironmentsTab importerId="imp_x" />);
    await waitFor(() => screen.getByRole("button", { name: /^Staging/i }));
    expect(screen.getByDisplayValue("https://example.com/old")).toBeInTheDocument();
    expect(screen.getByText(/^Production/i)).toBeInTheDocument();
  });

  it("PUT-saves the updated webhook URL and batch size on the active env", async () => {
    render(<EnvironmentsTab importerId="imp_x" />);
    await waitFor(() => screen.getByDisplayValue("https://example.com/old"));

    const urlInput = screen.getByDisplayValue("https://example.com/old") as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://example.com/new" } });

    const batchInput = screen.getByDisplayValue("1000") as HTMLInputElement;
    fireEvent.change(batchInput, { target: { value: "2500" } });

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(putBodies.length).toBeGreaterThan(0);
    });
    const sent = putBodies[0] as { url: string; body: { webhook_url: string; batch_size: number } };
    expect(sent.url).toContain("/environments/env_evo_staging");
    expect(sent.body.webhook_url).toBe("https://example.com/new");
    expect(sent.body.batch_size).toBe(2500);
  });

  it("for an unconfigured env: no key shown, save button labelled 'Save and enable'", async () => {
    render(<EnvironmentsTab importerId="imp_x" />);
    await waitFor(() => screen.getByRole("button", { name: /^Production/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Production/i }));

    expect(screen.queryByText(/public key/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save and enable/i })).toBeInTheDocument();
  });
});
