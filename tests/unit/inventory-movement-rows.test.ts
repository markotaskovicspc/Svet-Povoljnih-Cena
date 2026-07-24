import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  stockMovementFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    stockMovement: {
      findMany: dbMocks.stockMovementFindMany,
    },
  },
}));

import { getOperationalErpRows } from "@/lib/admin/erp-operations";

describe("inventory movement ERP rows", () => {
  beforeEach(() => {
    dbMocks.stockMovementFindMany.mockResolvedValue([
      {
        id: "movement-1",
        idempotencyKey: "receipt-1",
        sku: "SKU-009",
        kind: "PURCHASE_RECEIPT",
        qty: 7,
        balanceAfterWarehouse: 12,
        balanceAfterTotal: 19,
        note: "Prijem robe",
        createdAt: new Date("2030-05-06T07:08:09.000Z"),
        warehouse: { name: "Glavni magacin" },
        product: {
          name: "Puni naziv",
          shortName: "Kratki naziv",
          shortDescription: "Kratki opis",
          attribute1: "A1",
          attribute2: "A2",
          attribute3: "A3",
          attribute4: "A4",
          colorPrimary: "Plava",
          colorSecondary: "Bela",
          supplier: { name: "Dobavljač d.o.o." },
          group: { name: "Grupa" },
          collection: { name: "Kolekcija" },
          categories: [
            {
              category: {
                name: "Podgrupa",
                parent: { name: "Kategorija" },
              },
            },
          ],
        },
        orderItem: null,
      },
    ]);
  });

  it("automatically expands an immutable movement with article master data", async () => {
    const rows = await getOperationalErpRows("kretanja-zaliha", 25);

    expect(dbMocks.stockMovementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25, orderBy: { createdAt: "desc" } }),
    );
    expect(rows).toEqual([
      {
        id: "movement-1",
        values: {
          sku: "SKU-009",
          supplier: "Dobavljač d.o.o.",
          category: "Kategorija",
          group: "Grupa",
          subgroup: "Podgrupa",
          collection: "Kolekcija",
          shortDescription: "Kratki opis",
          shortName: "Kratki naziv",
          attribute1: "A1",
          attribute2: "A2",
          attribute3: "A3",
          attribute4: "A4",
          color1: "Plava",
          color2: "Bela",
          createdAt: "2030-05-06T07:08:09.000Z",
          kind: "Prijem robe",
          qty: 7,
          warehouse: "Glavni magacin",
          balanceAfterWarehouse: 12,
          balanceAfterTotal: 19,
          note: "Prijem robe",
          idempotencyKey: "receipt-1",
        },
      },
    ]);
  });

  it("falls back to the order snapshot when the article no longer exists", async () => {
    dbMocks.stockMovementFindMany.mockResolvedValue([
      {
        id: "movement-2",
        idempotencyKey: null,
        sku: "OLD-009",
        kind: "SALE_RESERVATION",
        qty: -2,
        balanceAfterWarehouse: 3,
        balanceAfterTotal: 8,
        note: null,
        createdAt: new Date("2030-05-07T07:08:09.000Z"),
        warehouse: { name: "Prodavnica" },
        product: null,
        orderItem: {
          name: "Stari puni naziv",
          supplierName: "Stari dobavljač",
          categoryName: "Stara kategorija",
          groupName: "Stara grupa",
          subgroupName: "Stara podgrupa",
          collectionName: "Stara kolekcija",
          shortDescriptionSnapshot: "Stari opis",
          shortNameSnapshot: "Stari naziv",
          attribute1: "S1",
          attribute2: "S2",
          attribute3: "S3",
          attribute4: "S4",
          color1: "Crna",
          color2: "Siva",
        },
      },
    ]);

    const [row] = await getOperationalErpRows("kretanja-zaliha", 25);

    expect(row.values).toMatchObject({
      supplier: "Stari dobavljač",
      category: "Stara kategorija",
      group: "Stara grupa",
      subgroup: "Stara podgrupa",
      collection: "Stara kolekcija",
      shortDescription: "Stari opis",
      shortName: "Stari naziv",
      attribute1: "S1",
      color2: "Siva",
      kind: "Fiskalizacija / prodaja",
      qty: -2,
      balanceAfterWarehouse: 3,
      balanceAfterTotal: 8,
    });
  });
});
