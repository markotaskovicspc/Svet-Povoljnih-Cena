import { describe, expect, it, vi } from "vitest";
import {
  mergeGuestCart,
  mergeGuestWishlist,
  persistGuestCommerce,
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

  it("promotes a guest snapshot only after cart and wishlist are durable", async () => {
    let finishWishlist: ((saved: boolean) => void) | undefined;
    const cart = vi.fn(async () => true);
    const wishlist = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishWishlist = resolve;
        }),
    );

    const saved = persistGuestCommerce(
      { cart: [], wishlist: [] },
      { cart, wishlist },
    );
    let settled = false;
    void saved.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(cart).toHaveBeenCalledOnce();
    expect(wishlist).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    finishWishlist?.(true);
    await expect(saved).resolves.toBe(true);
  });

  it("keeps the snapshot in guest mode when either server write fails", async () => {
    await expect(
      persistGuestCommerce(
        { cart: [], wishlist: [] },
        {
          cart: async () => true,
          wishlist: async () => false,
        },
      ),
    ).resolves.toBe(false);
  });
});
