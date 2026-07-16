import { describe, expect, it } from "vitest";
import { isAuthorized } from "@/lib/admin/authorization";

describe("admin role authorization", () => {
  it("lets SUPER access every module", () => {
    expect(isAuthorized("SUPER", [])).toBe(true);
    expect(isAuthorized("SUPER", ["OPS"])).toBe(true);
  });

  it("enforces CONTENT, OPS and ADS allow-lists", () => {
    expect(isAuthorized("CONTENT", ["CONTENT", "OPS"])).toBe(true);
    expect(isAuthorized("CONTENT", ["OPS"])).toBe(false);
    expect(isAuthorized("OPS", ["OPS"])).toBe(true);
    expect(isAuthorized("OPS", ["ADS"])).toBe(false);
    expect(isAuthorized("ADS", ["ADS", "OPS"])).toBe(true);
    expect(isAuthorized("ADS", ["CONTENT"])).toBe(false);
  });

  it("denies missing sessions", () => {
    expect(isAuthorized(null, ["OPS"])).toBe(false);
    expect(isAuthorized(undefined, ["CONTENT"])).toBe(false);
  });
});
