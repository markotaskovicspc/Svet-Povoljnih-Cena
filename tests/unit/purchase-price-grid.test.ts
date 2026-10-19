import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ prices: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { purchasePrice: { findMany: mocks.prices } },
}));

import { getErpModule } from "@/lib/admin/erp";

const product = {
  name: "Ženske čarape MIMI PLUS 40 REPOSE, GLACE, XL",
  attribute1: "VELIČINA XL",
  attribute2: "40 DEN",
  attribute3: null,
  attribute4: null,
  sizeLabel: null,
  colorPrimary: "bež",
  colorSecondary: null,
};
const price = {
  id: "price-100062",
  sku: "100062",
  name: "Ženske čarape PRESTIGE 40DEN, crne, L",
  attributes: "VELIČINA L / 40 DEN",
  pattern: "crna",
  price: 53.1,
  currency: "RSD",
  parity: "DAP",
  validFrom: new Date("2026-08-01T00:00:00.000Z"),
  validTo: null,
  supplier: { name: "Modital doo" },
  product,
};

async function firstRow() {
  const module = await getErpModule("nabavne-cene", {
    take: 100,
    includeLookupOptions: false,
  });
  return module!.rows[0];
}

describe("purchase-price grid article descriptions", () => {
  beforeEach(() => {
    mocks.prices.mockResolvedValue([price]);
  });

  it("shows the current linked article while retaining the recorded price and period", async () => {
    expect(await firstRow()).toEqual({
      id: "price-100062",
      values: {
        sku: "100062",
        supplier: "Modital doo",
        name: product.name,
        attributes: "VELIČINA XL / 40 DEN",
        pattern: "bež",
        purchasePrice: 53.1,
        currency: "RSD",
        parity: "DAP",
        validFrom: "2026-08-01",
        validTo: null,
      },
    });
    expect(price.name).toBe("Ženske čarape PRESTIGE 40DEN, crne, L");
    expect(price.attributes).toBe("VELIČINA L / 40 DEN");
    expect(price.pattern).toBe("crna");
  });

  it("does not resurrect old attributes or colors after they are cleared in the article", async () => {
    mocks.prices.mockResolvedValue([
      {
        ...price,
        product: {
          ...product,
          attribute1: null,
          attribute2: null,
          colorPrimary: null,
        },
      },
    ]);
    expect((await firstRow()).values).toMatchObject({
      name: product.name,
      attributes: null,
      pattern: null,
    });
  });

  it("retains historical descriptions when the linked article is unavailable", async () => {
    mocks.prices.mockResolvedValue([{ ...price, product: null }]);
    expect((await firstRow()).values).toMatchObject({
      name: price.name,
      attributes: price.attributes,
      pattern: price.pattern,
      purchasePrice: 53.1,
    });
  });
});
