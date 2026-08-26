import { describe, expect, it } from "vitest";
import {
  buildMetaAddToCartPayload,
  buildMetaInitiateCheckoutPayload,
  buildMetaPurchasePayload,
  buildMetaViewContentPayload,
  getMetaPixelId,
  metaPurchaseEventId,
} from "@/lib/analytics/meta-ecommerce";
import type { Order } from "@/types";

describe("Meta ecommerce payloads", () => {
  it("accepts only a numeric Pixel ID and rejects placeholders", () => {
    expect(getMetaPixelId("4622399164665144")).toBe("4622399164665144");
    expect(getMetaPixelId("GET_FROM_META_EVENTS_MANAGER")).toBeNull();
    expect(getMetaPixelId("pixel-4622399164665144")).toBeNull();
    expect(getMetaPixelId("")).toBeNull();
  });

  it("maps concrete SKUs and RSD values to standard Meta commerce fields", () => {
    const item = {
      sku: "SKU-1",
      name: "Test stolica",
      unitPrice: 900,
      fullUnitPrice: 1_000,
      quantity: 2,
      categories: ["Nameštaj", "Stolice"],
    };

    expect(buildMetaViewContentPayload({ ...item, quantity: 1 })).toEqual({
      currency: "RSD",
      value: 900,
      content_ids: ["SKU-1"],
      content_type: "product",
      contents: [{ id: "SKU-1", quantity: 1, item_price: 900 }],
      content_name: "Test stolica",
      content_category: "Nameštaj > Stolice",
    });
    expect(buildMetaAddToCartPayload(item).value).toBe(1_800);
  });

  it("builds checkout and purchase values from the same authoritative pricing as GA4", () => {
    const checkout = buildMetaInitiateCheckoutPayload([
      { sku: "A", name: "A", unitPrice: 1_000, quantity: 1 },
      { sku: "B", name: "B", unitPrice: 500, quantity: 2 },
    ], { discount: 200 });
    expect(checkout).toEqual(
      expect.objectContaining({ value: 1_800, num_items: 3 }),
    );

    const order = sampleOrder();
    expect(buildMetaPurchasePayload(order)).toEqual(
      expect.objectContaining({
        currency: "RSD",
        value: 1_775,
        content_ids: ["SKU-1"],
        num_items: 2,
        order_id: "SPC-2026-0001",
      }),
    );
    expect(metaPurchaseEventId(order.id)).toBe("purchase:SPC-2026-0001");
  });
});

function sampleOrder(): Order {
  return {
    id: "SPC-2026-0001",
    status: "kreirano",
    items: [
      {
        sku: "SKU-1",
        name: "Test stolica",
        qty: 2,
        unitPriceFull: 1_100,
        unitPriceSale: 900,
        withAssembly: true,
        assemblyPrice: 75,
      },
    ],
    subtotal: 1_800,
    savings: 400,
    shipping: 350,
    assemblyTotal: 150,
    voucherCode: "POPUST100",
    voucherDiscount: 100,
    firstPurchaseDiscount: 50,
    savedCardDiscount: 25,
    total: 2_125,
    shippingMethod: "kamion",
    paymentMethod: "pouzece_gotovina",
    shippingAddress: {
      id: "shipping",
      firstName: "Test",
      lastName: "Kupac",
      phone: "0600000000",
      street: "Test 1",
      city: "Šabac",
      postalCode: "15000",
      country: "RS",
    },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}
