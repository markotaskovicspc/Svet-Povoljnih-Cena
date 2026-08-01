import { describe, expect, it } from "vitest";
import { repriceCartLines } from "@/lib/hooks/use-cart";

describe("cart repricing", () => {
  it("updates price snapshots without changing quantity or assembly", () => {
    const [line] = repriceCartLines(
      [
        {
          sku: "SKU-1",
          slug: "old",
          name: "Old",
          qty: 3,
          unitPriceFull: 1_000,
          unitPriceSale: 1_000,
          withAssembly: true,
          assemblyPrice: 250,
        },
      ],
      [
        {
          sku: "SKU-1",
          slug: "new",
          name: "New",
          unitPriceFull: 1_000,
          unitPriceSale: 700,
          thumbnailUrl: "/new.webp",
        },
      ],
    );

    expect(line).toMatchObject({
      sku: "SKU-1",
      slug: "new",
      name: "New",
      qty: 3,
      unitPriceFull: 1_000,
      unitPriceSale: 700,
      withAssembly: true,
      assemblyPrice: 250,
      thumbnailUrl: "/new.webp",
    });
  });
});
