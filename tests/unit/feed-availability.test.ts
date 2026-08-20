import { describe, expect, it } from "vitest";
import { resolveFeedAvailability } from "@/lib/feeds/availability";

describe("feed availability", () => {
  it("does not advertise another warehouse as ordinary web stock", () => {
    expect(
      resolveFeedAvailability({
        aggregateStock: 131,
        dcAvailableQty: 0,
        incomingStock: 0,
        supplierIntegrationKey: null,
      }),
    ).toBe("out of stock");
  });

  it("advertises ordinary products as in stock only from DC", () => {
    expect(
      resolveFeedAvailability({
        aggregateStock: 131,
        dcAvailableQty: 2,
        incomingStock: 0,
        supplierIntegrationKey: null,
      }),
    ).toBe("in stock");
  });

  it("preserves the existing Rabalux feed stock source", () => {
    expect(
      resolveFeedAvailability({
        aggregateStock: 4,
        dcAvailableQty: 0,
        incomingStock: 0,
        supplierIntegrationKey: "RABALUX",
      }),
    ).toBe("in stock");
  });
});
