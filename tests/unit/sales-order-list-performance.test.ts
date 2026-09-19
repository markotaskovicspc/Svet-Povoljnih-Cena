import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ orders: vi.fn(), shipments: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/db")>(),
  db: { order: { findMany: mocks.orders }, $queryRaw: mocks.shipments },
}));
import { getOperationalErpRows } from "@/lib/admin/erp-operations";

const createdAt = new Date("2026-09-19T08:00:00Z");
const order = {
  id: "order-a", number: "SPC-A", createdAt, shippingMethod: "KURIR",
  status: "U_OBRADI", paymentMethod: "KARTICA", channel: "WEB",
  shipFirstName: "Test", shipLastName: "Kupac", shipStreet: "Ulica 1",
  shipCity: "Beograd", shipPostalCode: "11000", billingSameAsShipping: true,
  customer: { email: "test@example.invalid" }, shipping: 300,
  firstPurchaseDiscount: 100, fiscal: null, fiscalDocuments: [],
  paymentRefunds: [], invoices: [], payments: [{ status: "PAID" }],
  items: [{ id: "item-a", sku: "SKU-A", name: "Artikal", qty: 2,
    unitPriceSale: 600, product: null, fiscalLines: [], warehouse: { name: "DC" } }],
};
const shipment = {
  orderId: "order-a", provider: "X_EXPRESS", status: "DELIVERED",
  createdAt, updatedAt: createdAt, rawCreateResponse: {
    assignment: { orderItemIds: ["item-a"], codAmount: 0 },
  },
};

beforeEach(() => {
  mocks.orders.mockResolvedValue([order]);
  mocks.shipments.mockResolvedValue([shipment]);
});

describe("sales list projected courier metadata", () => {
  it("preserves item totals, discount, delivery charge and courier display", async () => {
    const rows = await getOperationalErpRows("prodajni-nalozi");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "item-a", values: {
      sku: "SKU-A", qty: 2, unitPrice: 600, totalGross: 1100,
      courierService: "X Express", courierStatus: "Isporučeno",
      email: "test@example.invalid", warehouse: "DC",
    } });
    expect(rows[1]).toMatchObject({ id: "order-a", values: { qty: 1, totalGross: 300 } });
    expect(mocks.orders.mock.calls[0][0].include.shipments).toBeUndefined();
    const query = mocks.shipments.mock.calls[0][0];
    expect(query.text).toContain("jsonb_build_object");
    expect(query.text).toContain('"purpose" = \'ORDER_DELIVERY\'');
    expect(query.values).toEqual(["order-a"]);
  });

  it("keeps another order's courier out and preserves partial handover metadata", async () => {
    mocks.orders.mockResolvedValue([order, { ...order, id: "order-b", items: [{ ...order.items[0], id: "item-b" }] }]);
    mocks.shipments.mockResolvedValue([{ ...shipment, rawCreateResponse: {
      ...shipment.rawCreateResponse,
      packageHandover: { version: 1, expectedPackages: 2, pickedUpPackages: 1,
        recordedAt: createdAt.toISOString(), note: "Jedan paket čeka preuzimanje", source: "ADMIN" },
    } }]);
    const rows = await getOperationalErpRows("prodajni-nalozi");
    expect(rows.find(row => row.id === "item-a")?.values.courierStatus).toContain("Delimično");
    expect(rows.find(row => row.id === "item-b")?.values.courierStatus).toBe("Nalog nije kreiran");
  });

  it("retains financial status precedence over courier delivery", async () => {
    mocks.orders.mockResolvedValue([{ ...order, payments: [{ status: "REFUNDED" }] }]);
    const rows = await getOperationalErpRows("prodajni-nalozi");
    expect(rows[0].values.courierStatus).toBe("Refundirano");
  });

  it("does not query shipments for an empty result", async () => {
    mocks.orders.mockResolvedValue([]);
    expect(await getOperationalErpRows("prodajni-nalozi")).toEqual([]);
    expect(mocks.shipments).not.toHaveBeenCalled();
  });
});
