import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../src/routes/login";

const DEFAULT_LANDING = "/admin/importers";

describe("safeReturnTo (open-redirect guard)", () => {
  it("defaults when return_to is absent", () => {
    expect(safeReturnTo(undefined)).toBe(DEFAULT_LANDING);
    expect(safeReturnTo("")).toBe(DEFAULT_LANDING);
  });

  it("honours a same-origin path-absolute reference", () => {
    expect(safeReturnTo("/admin/settings")).toBe("/admin/settings");
    expect(safeReturnTo("/admin/importers/imp_tenants/upload?x=1#y")).toBe(
      "/admin/importers/imp_tenants/upload?x=1#y",
    );
  });

  it("rejects an absolute off-site URL", () => {
    expect(safeReturnTo("https://evil.com")).toBe(DEFAULT_LANDING);
    expect(safeReturnTo("http://evil.com/admin")).toBe(DEFAULT_LANDING);
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeReturnTo("//evil.com")).toBe(DEFAULT_LANDING);
    expect(safeReturnTo("//evil.com/admin/importers")).toBe(DEFAULT_LANDING);
  });

  it("rejects a backslash-smuggled host the URL parser normalises off-origin", () => {
    expect(safeReturnTo("/\\evil.com")).toBe(DEFAULT_LANDING);
    expect(safeReturnTo("/\\/evil.com")).toBe(DEFAULT_LANDING);
  });

  it("rejects non-path references (no leading slash)", () => {
    expect(safeReturnTo("javascript:alert(1)")).toBe(DEFAULT_LANDING);
    expect(safeReturnTo("admin/importers")).toBe(DEFAULT_LANDING);
  });

  it("collapses a same-origin absolute URL back to its path", () => {
    const sameOrigin = `${window.location.origin}/admin/settings?tab=members`;
    // An absolute same-origin URL has no leading "/" so it is dropped — only
    // path-absolute references are honoured. This documents the strict contract.
    expect(safeReturnTo(sameOrigin)).toBe(DEFAULT_LANDING);
  });
});
