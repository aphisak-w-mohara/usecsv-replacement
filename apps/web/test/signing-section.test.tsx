import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SigningSection } from "../src/components/importers/signing-section";

const BASE_IE = {
  id: "impenv_x",
  key: "key-abc",
  webhook_signing_enabled: false,
  secret_set: false,
};

beforeEach(() => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";

    if (url.endsWith("/signing") && method === "POST") {
      return new Response(
        JSON.stringify({
          secret: "secret-one-time-value",
          importer_environment: { ...BASE_IE, webhook_signing_enabled: true, secret_set: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/rotate-secret") && method === "POST") {
      return new Response(
        JSON.stringify({
          secret: "rotated-secret",
          importer_environment: { ...BASE_IE, webhook_signing_enabled: true, secret_set: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/rotate-key") && method === "POST") {
      return new Response(
        JSON.stringify({
          importer_environment: {
            ...BASE_IE,
            key: "key-new",
            webhook_signing_enabled: true,
            secret_set: true,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("/signing") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SigningSection", () => {
  it("Enable signing reveals the secret in a one-time modal and notifies parent", async () => {
    const onUpdated = vi.fn();
    render(
      <SigningSection
        importerId="imp_x"
        envId="env_x"
        importerEnvironment={BASE_IE}
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /enable signing/i }));

    await waitFor(() => screen.getByRole("dialog"));
    expect(screen.getByText(/won't be able to see this secret again/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("secret-one-time-value")).toBeInTheDocument();
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ webhook_signing_enabled: true, secret_set: true }),
    );
  });

  it("shows Rotate/Disable buttons when signing is already enabled", () => {
    render(
      <SigningSection
        importerId="imp_x"
        envId="env_x"
        importerEnvironment={{ ...BASE_IE, webhook_signing_enabled: true, secret_set: true }}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /rotate secret/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rotate public key/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable signing/i })).toBeInTheDocument();
  });

  it("Disable signing requires confirmation and then flips back to Enable", async () => {
    const onUpdated = vi.fn();
    render(
      <SigningSection
        importerId="imp_x"
        envId="env_x"
        importerEnvironment={{ ...BASE_IE, webhook_signing_enabled: true, secret_set: true }}
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /disable signing/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^disable signing$/i }));

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ webhook_signing_enabled: false, secret_set: false }),
      );
    });
  });

  it("Rotate secret returns a new value and shows it in the reveal modal", async () => {
    const onUpdated = vi.fn();
    render(
      <SigningSection
        importerId="imp_x"
        envId="env_x"
        importerEnvironment={{ ...BASE_IE, webhook_signing_enabled: true, secret_set: true }}
        onUpdated={onUpdated}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rotate secret/i }));
    await waitFor(() => screen.getByDisplayValue("rotated-secret"));
  });
});
