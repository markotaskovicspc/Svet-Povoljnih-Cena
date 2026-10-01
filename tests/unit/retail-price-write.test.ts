import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeRetailPriceTimeline, upsertRetailPriceInterval } from "@/lib/pricing/retail-price-write.server";

describe("retail price timeline writes", () => {
  it("saves an unlimited replacement price and closes the previous entry without deleting history", async () => {
    const validFrom = new Date("2026-09-30T22:00:00.000Z");
    const latest = { id: "october", validFrom, validTo: null };
    const tx = { priceListEntry: {
      upsert: vi.fn().mockResolvedValue(latest),
      findMany: vi.fn().mockResolvedValue([
        { id: "september", validFrom: new Date("2026-09-14T22:00:00Z"), validTo: null },
        latest,
      ]),
      update: vi.fn().mockResolvedValue({}),
    } };
    await upsertRetailPriceInterval(tx as never, { priceListId: "mp", productId: "100058", price: 999, validFrom, validTo: null });
    expect(tx.priceListEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ validTo: null }),
      update: expect.objectContaining({ validTo: null }),
    }));
    expect(tx.priceListEntry.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "september" }, data: { validTo: new Date("2026-09-30T21:59:59.999Z") },
    });
  });
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
