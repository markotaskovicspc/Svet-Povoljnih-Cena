import { beforeEach, describe, expect, it } from "vitest";
import { checkoutOrderBump, defaultOrderBumpSku, normalizeOrderBump, orderBumpSchema } from "@/lib/order-bump";
import { normalizeCartLines, repriceCartLines, useCart, mergeRecoveredCartLines } from "@/lib/hooks/use-cart";
import { createOrderSchema } from "@/lib/checkout/order-schema";

const attribution = { offerId: "clean-home-v1", sourceSku: "CHAIR", quantity: 1 };
const chair = { sku: "CHAIR", slug: "chair", name: "Chair", unitPriceFull: 2500, unitPriceSale: 2500 };
const table = { sku: "TABLE", slug: "table", name: "Table", unitPriceFull: 4000, unitPriceSale: 3000 };

beforeEach(() => useCart.getState().clear());

it("suggests Marko's selected CLEAN HOME vacuum only for the two selected chair models", () => {
  expect(defaultOrderBumpSku("Trpezarijska stolica CITY LINE")).toBe("210008");
  expect(defaultOrderBumpSku("Trpezarijska stolica Elegance Seat siva")).toBe("210008");
  expect(defaultOrderBumpSku("BON APPETIT 3u1")).toBeUndefined();
  expect(defaultOrderBumpSku("URBAN SEAT")).toBeUndefined();
});

describe("cart order bump attribution", () => {
  it("keeps only explicitly added units attributed, through quantity, repricing and reload", () => {
    useCart.getState().add(chair, 2);
    useCart.getState().add({ ...table, orderBump: attribution });
    useCart.getState().add(table, 2);
    useCart.getState().setQty("TABLE", 8);
    const repriced = repriceCartLines(useCart.getState().lines, [{ ...table, unitPriceSale: 2800 }]);
    const restored = normalizeCartLines(JSON.parse(JSON.stringify(repriced)));
    expect(restored.find(line => line.sku === "TABLE")).toMatchObject({ qty: 8, unitPriceSale: 2800, orderBump: attribution });
    expect(checkoutOrderBump(restored[1])).toEqual(attribution);
  });
  it("drops removed additions and does not attribute an ordinary re-add", () => {
    useCart.getState().add(chair);
    useCart.getState().add({ ...table, orderBump: attribution });
    useCart.getState().remove("TABLE");
    useCart.getState().add(table);
    expect(useCart.getState().lines.find(line => line.sku === "TABLE")?.orderBump).toBeUndefined();
  });
  it("rejects self-reference, invalid tags and excessive quantity, while keeping the original source snapshot", () => {
    expect(checkoutOrderBump({ ...table, qty: 1, orderBump: attribution })).toEqual(attribution);
    expect(checkoutOrderBump({ ...table, qty: 1, orderBump: { ...attribution, sourceSku: "TABLE" } })).toBeUndefined();
    expect(normalizeOrderBump({ ...attribution, quantity: 5000 }, 1)).toBeUndefined();
    expect(normalizeOrderBump({ ...attribution, quantity: 3 }, 1)?.quantity).toBe(1);
    expect(orderBumpSchema.safeParse({ ...attribution, offerId: "x".repeat(161) }).success).toBe(false);
  });
  it("preserves attribution without duplicating units when recovering a signed-in cart", () => {
    const local = [{ ...table, qty: 1, orderBump: attribution }];
    expect(mergeRecoveredCartLines(local, [{ ...table, qty: 3 }])[0]).toMatchObject({ qty: 3, orderBump: attribution });
  });
  it("caps attribution when the shopper reduces quantity", () => {
    useCart.getState().add({ ...table, orderBump: { ...attribution, quantity: 3 } }, 3);
    useCart.getState().setQty("TABLE", 1);
    expect(useCart.getState().lines[0].orderBump?.quantity).toBe(1);
    useCart.getState().setQty("TABLE", 0);
    expect(useCart.getState().lines).toEqual([]);
  });
});

it("passes attribution through checkout validation, while a malformed optional tag never blocks an order", () => {
  const input = {
    guestEmail: "qa@example.test", lines: [{ sku: "CHAIR", qty: 2 }, { sku: "TABLE", qty: 1, orderBump: attribution }],
    shipping: { firstName: "Test", lastName: "Kupac", phone: "0600000000", street: "Test ulica", houseNumber: "1", city: "Beograd", postalCode: "11000" },
    shippingMethod: "KAMION", paymentMethod: "POUZECE_GOTOVINA", consent: true,
  };
  expect(createOrderSchema.parse(input).lines[1].orderBump).toEqual(attribution);
  expect(createOrderSchema.parse({ ...input, lines: [{ sku: "TABLE", qty: 1, orderBump: { broken: true } }] }).lines[0].orderBump).toBeUndefined();
});
