import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StepContext } from "../src/components/upload-wizard/step-context";

describe("StepContext", () => {
  it("renders all four fields", () => {
    render(<StepContext onSubmit={() => {}} />);
    expect(screen.getByLabelText(/ticket reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /advanced/i })).toBeInTheDocument();
  });

  it("submits an empty form with null payloads", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StepContext onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      ticketReference: "",
      note: "",
      userPayload: null,
      metadataPayload: null,
    });
  });

  it("packs ticket_reference and note into the metadata payload on submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StepContext onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/ticket reference/i), "EVO-1234");
    await user.type(screen.getByLabelText(/note/i), "test");
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      ticketReference: "EVO-1234",
      note: "test",
      userPayload: null,
      metadataPayload: { ticket_reference: "EVO-1234", note: "test" },
    });
  });

  it("disables Next when user_payload has invalid JSON", async () => {
    const user = userEvent.setup();
    render(<StepContext onSubmit={() => {}} />);

    await user.click(screen.getByRole("button", { name: /advanced/i }));
    await user.type(screen.getByLabelText(/user payload/i), "{foo: bar}");

    const next = screen.getByRole("button", { name: /^next$/i });
    expect(next).toBeDisabled();
    expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
  });

  it("disables Next when user_payload exceeds 4 KB", async () => {
    const user = userEvent.setup();
    render(<StepContext onSubmit={() => {}} />);

    await user.click(screen.getByRole("button", { name: /advanced/i }));
    const giant = JSON.stringify({ padding: "x".repeat(5000) });
    await user.type(screen.getByLabelText(/user payload/i), giant, {
      delay: 0,
    });

    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeDisabled();
  });

  it("passes parsed user_payload through onSubmit when valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<StepContext onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: /advanced/i }));
    await user.type(screen.getByLabelText(/user payload/i), '{"role": "ops"}');
    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        userPayload: { role: "ops" },
      }),
    );
  });
});
