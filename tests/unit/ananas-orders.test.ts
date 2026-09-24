import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAnanasOrder, normalizeAnanasShipments, ananasOrderStatus } from "@/lib/ananas/orders";
import { AnanasClient } from "@/lib/ananas/client";
const order = () => ({ id: "A-B", createdDate: "2026-09-24T10:00:00", currency: "RSD", totalPrice: "2400", paymentMethods: ["PBC", "VOUCHER"], billingAddress: { firstName: "Test", lastName: "Buyer", secret: "not-persisted" },
  items: [{ id: 1, productSku: "SKU", productName: "Test", quantity: 2, confirmedQuantity: 2, packedQuantity: 1, basePrice: "1200", grandTotal: "2400", grandTotalWithoutVat: "2000", vat: 20, takeRateTotal: 240 }],
});
afterEach(() => vi.unstubAllEnvs());
describe("Ananas order mirror", () => {
  it("preserves quantities, remote totals and payment methods without retaining unknown data", () => {
    const result = normalizeAnanasOrder(order());
    expect(result.createdAt.toISOString()).toBe("2026-09-24T10:00:00.000Z");
    expect(result.items[0]).toMatchObject({ id: "1", quantity: 2, confirmed: 2, packed: 1, gross: 2400, net: 2000, commission: 240 });
    expect(result.paymentMethods).toBe("PBC, VOUCHER");
    expect(result.billingAddress).not.toHaveProperty("secret");
    expect(result).not.toHaveProperty("stockMovement");
  });
  it("rejects invalid money, currency, duplicate items and dates", () => {
    for (const change of [{ totalPrice: -1 }, { currency: "EUR" }, { createdDate: "invalid" }, { items: [order().items[0], order().items[0]] }]) {
      expect(() => normalizeAnanasOrder({ ...order(), ...change })).toThrow();
    }
  });
  it("does not close a partially delivered order or assume an absent shipment is delivered", () => {
    const rows = normalizeAnanasShipments([{ orderId: "A-B", suborderId: "A-B-FBA-1", status: "DELIVERED", items: [{ orderedQuantity: 1 }] }]);
    expect(ananasOrderStatus(rows, 2).needsRefresh).toBe(true);
    expect(ananasOrderStatus([], 2)).toEqual({ status: "Čeka proveru", needsRefresh: true });
    expect(ananasOrderStatus(rows, 1)).toEqual({ status: "Isporučeno", needsRefresh: false });
    expect(ananasOrderStatus([{ ...rows[0], status: "LOST_UNVERIFIED" }], 1).needsRefresh).toBe(true);
  });
});
describe("Ananas orders API", () => {
  it("fetches all pages with fixed date filters and only GETs after authentication", async () => {
    vi.stubEnv("ANANAS_CLIENT_ID", "test"); vi.stubEnv("ANANAS_CLIENT_SECRET", "secret");
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: "test-access-token" }))
      .mockResolvedValueOnce(Response.json({ content: [order()], last: false }))
      .mockResolvedValueOnce(Response.json({ content: [{ ...order(), id: "C-D" }], last: true }));
    const rows = await new AnanasClient(request).orders(new URLSearchParams({ dateFrom: "2026-09-01T00:00:00Z" }));
    expect(rows).toHaveLength(2);
    const url = new URL(String(request.mock.calls[2][0]));
    expect(url.searchParams.get("page")).toBe("1"); expect(url.searchParams.get("size")).toBe("100");
    expect(url.searchParams.get("dateFrom")).toBe("2026-09-01T00:00:00Z");
    expect(request.mock.calls.slice(1).every(call => !call[1]?.method || call[1].method === "GET")).toBe(true);
  });
  it("does not silently accept an incomplete paginated response", async () => {
    vi.stubEnv("ANANAS_CLIENT_ID", "test"); vi.stubEnv("ANANAS_CLIENT_SECRET", "secret");
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: "test-access-token" }))
      .mockResolvedValueOnce(Response.json({ content: [], last: false }));
    await expect(new AnanasClient(request).orders(new URLSearchParams())).rejects.toThrow("paginacija");
  });
});
