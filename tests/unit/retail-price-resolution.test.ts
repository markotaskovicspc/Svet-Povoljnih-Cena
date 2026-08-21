import { describe, expect, it } from "vitest";
import { resolveRetailPrice } from "@/lib/pricing/retail-price";

const priceList = {
  id: "mp",
  name: "Maloprodajni cenovnik",
  code: "MP",
  active: true,
  validFrom: null,
  validTo: null,
};

describe("retail price resolution", () => {
  it("always chooses the newest active entry even when a caller passes unsorted rows", () => {
    const resolved = resolveRetailPrice(
      [
        {
          price: 7_141,
          validFrom: new Date("2026-08-02T00:00:00.000Z"),
          validTo: null,
          priceList,
        },
        {
          price: 5_713,
          validFrom: new Date("2026-08-03T00:00:00.000Z"),
          validTo: null,
          priceList,
        },
      ],
      7_141,
      new Date("2026-08-21T00:00:00.000Z"),
    );

    expect(resolved.price).toBe(5_713);
  });
});
