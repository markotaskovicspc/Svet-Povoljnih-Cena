import { describe, expect, it } from "vitest";
import { mobileFilterHeaderEnabled } from "@/lib/listing/mobile-filter-header";

describe("mobile listing header filters", () => {
  it("shows the sticky filter control on product listing routes", () => {
    expect(mobileFilterHeaderEnabled("/akcija")).toBe(true);
    expect(mobileFilterHeaderEnabled("/k/basta/namestaj")).toBe(true);
    expect(mobileFilterHeaderEnabled("/kolekcija/letnja")).toBe(true);
    expect(mobileFilterHeaderEnabled("/ponuda/vikend")).toBe(true);
  });

  it("keeps the regular full-width search outside listings", () => {
    expect(mobileFilterHeaderEnabled("/")).toBe(false);
    expect(mobileFilterHeaderEnabled("/p/test-artikal")).toBe(false);
    expect(mobileFilterHeaderEnabled("/korpa")).toBe(false);
  });
});
