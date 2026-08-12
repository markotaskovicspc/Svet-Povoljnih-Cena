import { describe, expect, it } from "vitest";
import {
  mergeGuestCart,
  mergeGuestWishlist,
} from "@/components/cart/customer-commerce-sync";

describe("customer commerce sync", () => {
  it("merges a guest cart once without doubling a server SKU", () => {
    const server = [
      {
        sku: "A",
        name: "Server A",
        slug: "server-a",
        qty: 2,
        unitPriceFull: 100,
        unitPriceSale: 90,
      },
    ];
    const local = [
      {
        sku: "A",
        name: "Local A",
        slug: "local-a",
        qty: 1,
        unitPriceFull: 100,
        unitPriceSale: 95,
      },
      {
        sku: "B",
        name: "Local B",
        slug: "local-b",
        qty: 3,
        unitPriceFull: 200,
        unitPriceSale: 180,
      },
    ];

    const merged = mergeGuestCart(local, server);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject(server[0]);
    expect(merged[1]).toMatchObject(local[1]);
  });

  it("unions wishlist items and preserves enabled alerts", () => {
    const merged = mergeGuestWishlist(
      [
        {
          sku: "A",
          notifyOnSale: true,
          addedAt: "2026-08-13T10:00:00.000Z",
        },
        { sku: "B", addedAt: "2026-08-13T10:01:00.000Z" },
      ],
      [
        {
          sku: "A",
          notifyOnRestock: true,
          addedAt: "2026-08-12T10:00:00.000Z",
        },
      ],
    );

    expect(merged.map((item) => item.sku)).toEqual(["A", "B"]);
    expect(merged[0]).toMatchObject({
      notifyOnSale: true,
      notifyOnRestock: true,
    });
  });
});
