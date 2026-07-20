import { describe, expect, it } from "vitest";
import {
  buildAddToCartPayload,
  buildBeginCheckoutPayload,
  buildPurchasePayload,
  buildViewItemPayload,
  isPurchaseReady,
} from "@/lib/analytics/ga4-ecommerce";
import {
  DEFAULT_GA4_MEASUREMENT_ID,
  getGa4MeasurementId,
} from "@/lib/analytics/config";
import type { Order } from "@/types";

describe("GA4 ecommerce payloads", () => {
  it("uses the store measurement ID when an environment override is absent or invalid", () => {
    expect(getGa4MeasurementId("")).toBe(DEFAULT_GA4_MEASUREMENT_ID);
    expect(getGa4MeasurementId("GET_FROM_GOOGLE_ANALYTICS")).toBe(
      DEFAULT_GA4_MEASUREMENT_ID,
    );
    expect(getGa4MeasurementId("G-OVERRIDE")).toBe("G-OVERRIDE");
  });

  it("builds view_item and add_to_cart with standard RSD item fields", () => {
    const input = {
      sku: "SKU-1",
      name: "Test stolica",
      unitPrice: 900,
      fullUnitPrice: 1_000,
      quantity: 2,
      categories: ["Nameštaj", "Stolice"],
    };

    expect(buildViewItemPayload({ ...input, quantity: 1 })).toEqual({
      currency: "RSD",
      value: 900,
      items: [
        expect.objectContaining({
          item_id: "SKU-1",
          item_name: "Test stolica",
          price: 900,
          quantity: 1,
          discount: 100,
          item_category: "Nameštaj",
          item_category2: "Stolice",
        }),
      ],
    });
    expect(buildAddToCartPayload(input).value).toBe(1_800);
  });

  it("includes coupon and allocates order discount in begin_checkout value", () => {
    const payload = buildBeginCheckoutPayload(
      [
        { sku: "A", name: "A", unitPrice: 1_000, quantity: 1 },
        { sku: "B", name: "B", unitPrice: 500, quantity: 2 },
      ],
      { coupon: "POPUST200", discount: 200 },
    );

    expect(payload.currency).toBe("RSD");
    expect(payload.coupon).toBe("POPUST200");
    expect(payload.value).toBe(1_800);
    expect(payload.items).toHaveLength(2);
  });

  it("builds a purchase without adding shipping to GA4 value", () => {
    const order = sampleOrder();
    const payload = buildPurchasePayload(order);

    expect(payload).toEqual(
      expect.objectContaining({
        transaction_id: "SPC-2026-0001",
        currency: "RSD",
        value: 1_850,
        shipping: 350,
        coupon: "POPUST100",
      }),
    );
    expect(payload.items[0]).toEqual(
      expect.objectContaining({
        item_id: "SKU-1",
        quantity: 2,
        price: 925,
      }),
    );
  });

  it("waits for successful prepaid payment but accepts deferred payments", () => {
    const order = sampleOrder();
    expect(isPurchaseReady(order)).toBe(true);
    expect(
      isPurchaseReady({ ...order, paymentMethod: "ips" }, "failed"),
    ).toBe(false);
    expect(
      isPurchaseReady({ ...order, paymentMethod: "ips" }, "paid"),
    ).toBe(true);
    expect(
      isPurchaseReady({
        ...order,
        paymentMethod: "kartica",
        payment: { status: "paid" },
      }),
    ).toBe(true);
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
    total: 2_200,
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
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}
