import { describe, expect, it } from "vitest";
import { injectUserId } from "../src/lib/inject-user-id.js";

describe("injectUserId", () => {
  it("injects session email as userId when payload is null", () => {
    const result = injectUserId(null, "aphisak@mohara.co");
    expect(result).toEqual({ userId: "aphisak@mohara.co" });
  });

  it("injects session email as userId when payload is an empty object", () => {
    const result = injectUserId({}, "aphisak@mohara.co");
    expect(result).toEqual({ userId: "aphisak@mohara.co" });
  });

  it("does NOT overwrite when the payload already has a userId", () => {
    const result = injectUserId({ userId: "custom-id", role: "ops" }, "aphisak@mohara.co");
    expect(result).toEqual({ userId: "custom-id", role: "ops" });
  });

  it("preserves other fields while adding userId", () => {
    const result = injectUserId({ extra: "value" }, "aphisak@mohara.co");
    expect(result).toEqual({ extra: "value", userId: "aphisak@mohara.co" });
  });
});
