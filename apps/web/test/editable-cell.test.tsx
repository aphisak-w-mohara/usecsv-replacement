import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditableCell } from "../src/components/upload-wizard/editable-cell";

describe("EditableCell", () => {
  it("renders the value as plain text initially (idle mode)", () => {
    render(<EditableCell value="alice@example.com" validation={{ ok: true }} onCommit={() => {}} />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("enters edit mode on click and pre-fills the input with the current value", () => {
    render(<EditableCell value="alice@example.com" validation={{ ok: true }} onCommit={() => {}} />);
    fireEvent.click(screen.getByText("alice@example.com"));
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("alice@example.com");
  });

  it("commits on Enter and calls onCommit with the new value", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("new");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("commits on Tab and calls onCommit with the new value", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Tab" });
    expect(onCommit).toHaveBeenCalledWith("new");
  });

  it("cancels on Escape and does NOT call onCommit", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("old")).toBeInTheDocument();
  });

  it("rejects values over 64 KB and keeps the input open with an alert", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="ok" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("ok"));
    const input = screen.getByRole("textbox");
    const giant = "x".repeat(70 * 1024);
    fireEvent.change(input, { target: { value: giant } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
  });

  it("commits on blur (clicking away)", () => {
    const onCommit = vi.fn();
    render(<EditableCell value="old" validation={{ ok: true }} onCommit={onCommit} />);
    fireEvent.click(screen.getByText("old"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith("new");
  });

  it("renders error styling + tooltip when validation is failing", () => {
    const failingValidation = {
      ok: false as const,
      severity: "error" as const,
      message: "Not a valid email address.",
    };
    render(<EditableCell value="bad" validation={failingValidation} onCommit={() => {}} />);
    const cell = screen.getByTitle(/not a valid email/i);
    expect(cell).toBeInTheDocument();
    expect(cell.textContent).toContain("bad");
    expect(cell.textContent).toMatch(/⚠/);
  });
});
