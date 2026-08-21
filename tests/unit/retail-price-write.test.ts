import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeRetailPriceTimeline } from "@/lib/pricing/retail-price-write.server";

describe("retail price timeline writes", () => {
  it("closes every overlapping price before the next one starts", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      priceListEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "old",
            validFrom: new Date("2026-08-02T00:00:00.000Z"),
            validTo: null,
          },
          {
            id: "current",
            validFrom: new Date("2026-08-03T00:00:00.000Z"),
            validTo: null,
          },
        ]),
        update,
      },
    };

    await normalizeRetailPriceTimeline(tx as never, {
      priceListId: "mp",
      productId: "flex-seat",
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "old" },
      data: { validTo: new Date("2026-08-02T23:59:59.999Z") },
    });
  });
});
