import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  dispatchNoteFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    dispatchNote: {
      findMany: dbMocks.dispatchNoteFindMany,
    },
  },
}));

import { getOperationalErpRows } from "@/lib/admin/erp-operations";

describe("stocktake dispatch ERP rows", () => {
  beforeEach(() => {
    dbMocks.dispatchNoteFindMany.mockReset();
  });

  it("shows only STOCKTAKE dispatches in Popisi with the fixed destination", async () => {
    dbMocks.dispatchNoteFindMany.mockResolvedValue([
      {
        id: "stocktake-1",
        number: "POP-2030-0001",
        destinationName: null,
        status: "DRAFT",
        postedAt: null,
        createdAt: new Date("2030-05-06T07:08:09.000Z"),
        sourceWarehouse: { name: "DC" },
        items: [{ qty: 2 }, { qty: 3 }],
      },
    ]);

    const rows = await getOperationalErpRows("popisi", 25);

    expect(dbMocks.dispatchNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: "STOCKTAKE", archivedAt: null },
        take: 25,
      }),
    );
    expect(rows).toEqual([
      {
        id: "stocktake-1",
        values: {
          number: "POP-2030-0001",
          source: "DC",
          destination: "Popis",
          status: "Nacrt",
          items: 2,
          totalQty: 5,
          postedAt: null,
          archivedAt: null,
          createdAt: "2030-05-06T07:08:09.000Z",
        },
      },
    ]);
  });

  it("keeps stocktake documents out of the regular dispatch list", async () => {
    dbMocks.dispatchNoteFindMany.mockResolvedValue([]);

    await getOperationalErpRows("otpremnice", 50);

    expect(dbMocks.dispatchNoteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: { in: ["CUSTOMER", "INTERNAL"] } },
        take: 50,
      }),
    );
  });
});
