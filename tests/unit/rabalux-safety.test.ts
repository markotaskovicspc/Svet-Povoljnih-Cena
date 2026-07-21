import { describe, expect, it } from "vitest";
import {
  assertFeedBaseline,
  assertSafeMissingShare,
  isRiskyPriceChange,
  missingGraceSatisfied,
  RabaluxCircuitBreakerError,
  stableSourceHash,
} from "@/lib/rabalux/safety";
import {
  applyRabaluxOverrides,
  mergeOverrideFields,
  parseOverrideFields,
} from "@/lib/rabalux/ownership";

describe("Rabalux sync safety", () => {
  it("opens the circuit when a feed shrinks below its absolute or historical baseline", () => {
    expect(() =>
      assertFeedBaseline({
        kind: "catalog",
        actual: 10,
        absoluteMinimum: 100,
      }),
    ).toThrow(RabaluxCircuitBreakerError);
    expect(() =>
      assertFeedBaseline({
        kind: "catalog",
        actual: 899,
        absoluteMinimum: 100,
        previousSuccessfulRows: 1_000,
      }),
    ).toThrow("shrank");
    expect(() =>
      assertFeedBaseline({
        kind: "catalog",
        actual: 900,
        absoluteMinimum: 100,
        previousSuccessfulRows: 1_000,
      }),
    ).not.toThrow();
  });

  it("blocks mass omission unless an approved preview explicitly allows it", () => {
    expect(() =>
      assertSafeMissingShare({ kind: "stock", existing: 1_000, missing: 51 }),
    ).toThrow(RabaluxCircuitBreakerError);
    expect(() =>
      assertSafeMissingShare({
        kind: "stock",
        existing: 1_000,
        missing: 600,
        allowLargeRemoval: true,
      }),
    ).not.toThrow();
  });

  it("requires both repeated absence and elapsed grace time", () => {
    const now = new Date("2026-07-21T12:00:00Z");
    expect(
      missingGraceSatisfied({
        nextCount: 3,
        firstMissingAt: new Date("2026-07-21T11:31:00Z"),
        now,
        confirmations: 3,
        graceMs: 30 * 60_000,
      }),
    ).toBe(false);
    expect(
      missingGraceSatisfied({
        nextCount: 3,
        firstMissingAt: new Date("2026-07-21T11:30:00Z"),
        now,
        confirmations: 3,
        graceMs: 30 * 60_000,
      }),
    ).toBe(true);
  });

  it("detects risky prices and hashes equivalent object key order identically", () => {
    expect(isRiskyPriceChange(1_000, 1_100)).toBe(false);
    expect(isRiskyPriceChange(1_000, 1_101)).toBe(true);
    expect(stableSourceHash({ b: 2, a: 1 })).toBe(
      stableSourceHash({ a: 1, b: 2 }),
    );
  });
});

describe("Rabalux field ownership", () => {
  it("merges automatic manual locks and applies every configured group", () => {
    const merged = mergeOverrideFields(
      { fields: ["name"], updatedBy: "old", updatedAt: "old" },
      ["stock", "flags", "attachments", "specifications"],
      "admin-1",
    );
    const fields = parseOverrideFields(merged);
    const protectedUpdate = applyRabaluxOverrides(
      {
        name: "Feed",
        supplierStock: 5,
        articleStatus: "ARH",
        isActive: false,
        technicalSpecs: [{ key: "x" }],
        colorPrimary: "Crna",
        attachments: [{ id: "a" }],
        description: "Feed opis",
      },
      fields,
    );
    expect(protectedUpdate).toEqual({ description: "Feed opis" });
    expect(merged.updatedBy).toBe("admin-1");
  });
});
