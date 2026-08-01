import { describe, expect, it } from "vitest";
import {
  formatBelgradePricingDateTime,
  parseBelgradePricingDateTime,
} from "@/lib/admin/pricing-date-time";
import { actionSalePriceError } from "@/lib/pricing/action-price";

describe("pricing admin date and price validation", () => {
  it("parses and formats Serbian summer and winter wall-clock times", () => {
    const summer = parseBelgradePricingDateTime("2026-08-01T00:00");
    const winter = parseBelgradePricingDateTime("2026-01-01T00:00");

    expect(summer.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(winter.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(formatBelgradePricingDateTime(summer)).toBe("2026-08-01T00:00");
    expect(formatBelgradePricingDateTime(winter)).toBe("2026-01-01T00:00");
  });

  it("rejects invalid calendar values and a skipped DST wall-clock time", () => {
    expect(() => parseBelgradePricingDateTime("2026-02-30T12:00")).toThrow(
      "Datum i vreme nisu ispravni.",
    );
    expect(() => parseBelgradePricingDateTime("2026-03-29T02:30")).toThrow(
      "ne postoji",
    );
  });

  it("requires the action price to be lower than the valid retail price", () => {
    expect(actionSalePriceError(3_990, 4_490)).toBeNull();
    expect(actionSalePriceError(4_490, 4_490)).toContain("mora biti manja");
    expect(actionSalePriceError(4_900, 4_490)).toContain("mora biti manja");
  });
});
