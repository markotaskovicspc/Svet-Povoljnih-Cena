import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orders: vi.fn(), count: vi.fn(), reclamations: vi.fn(), reshipments: vi.fn(),
  jobs: vi.fn(), warehouses: vi.fn(), movements: vi.fn(), authorize: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  order: { findMany: mocks.orders, count: mocks.count },
  orderReshipment: { findMany: mocks.reshipments },
  reclamation: { findMany: mocks.reclamations },
  warehouse: { findMany: mocks.warehouses },
  stockMovement: { findMany: mocks.movements },
  backgroundJob: { findMany: mocks.jobs },
} }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize, withAdminState: vi.fn() }));
vi.mock("@/lib/admin/reclamation-fulfillment.server", () => ({ receiveReclamationReturn: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import ReturnsPage from "@/app/admin/erp/povrati/page";

const returnedOrder = (id: string, shipments = [{
  id: `shipment-${id}`, provider: "X_EXPRESS", trackingNo: `TRACK-${id}`,
  lastStatusEventAt: new Date("2026-09-10T10:00:00Z"),
}]) => ({
  id, number: `SPC-${id}`,
  items: [{ id: `item-${id}`, sku: `SKU-${id}`, name: "Vraćeni artikal", qty: 2 }],
  shipments,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.jobs.mockResolvedValue([]);
  mocks.reshipments.mockResolvedValue([]);
  mocks.orders.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.reclamations.mockResolvedValue([]);
  mocks.warehouses.mockResolvedValue([]);
  mocks.movements.mockResolvedValue([]);
});

describe("ERP returns page", () => {
  it("shows the unresolved old shipment for stock-only receipt while the new picking stays linked", async () => {
    mocks.reshipments.mockResolvedValue([{ id: "r", orderId: "o", batchId: "b", reason: "Kurir ne nalazi robu", order: { number: "SPC-RETRY" }, batch: { number: "PRE-NEW" }, sourceShipmentId: "s", sourceShipment: { provider: "X_EXPRESS", trackingNo: "OLD-TRACK", status: "IN_TRANSIT" }, items: [{ id: "ri", sku: "SKU", name: "Sto", quantity: 2, receivedQty: 1 }] }]);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(html).toContain("OLD-TRACK");
    expect(html).toContain("Primljeno 1/2 kom");
    expect(html).toContain("Primi 1 kom na lager");
    expect(html).toContain("bez refundacije kupcu");
    expect(html).toContain("/admin/erp/preuzimanja/b");
    expect(html).not.toContain('name="buyerId"');
  });
  it("shows the missing refund data and a retry for an already received package", async () => {
    mocks.orders.mockResolvedValue([returnedOrder("1")]);
    mocks.movements.mockResolvedValue([{ id: "receipt", idempotencyKey: "order-return:SPC-1:item-1:1", warehouseId: "warehouse", createdAt: new Date(), warehouse: { code: "MAG-004", name: "Povrati" } }]);
    mocks.jobs.mockImplementation(({ where }) => where.kind ? [] : [{ idempotencyKey: "return-fiscal:receipt", status: "RETRY", lastError: "Refundacija čeka identifikaciju kupca." }]);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(html).toContain("Refundacija čeka identifikaciju kupca.");
    expect(html).toContain("Dopuni / ponovi refundaciju");
    expect(html).toContain('name="buyerId"');
    expect(html).not.toContain("Fiskalna refundacija obrađena.");
  });

  it("keeps the refund marked processed after completed background jobs are cleaned up", async () => {
    const order = returnedOrder("1");
    mocks.orders.mockResolvedValue([{ ...order, items: [{ ...order.items[0], fiscalLines: [{ refundedQty: 1 }] }],
      paymentRefunds: [{ status: "PENDING", error: "Povraćaj novca zahteva ručnu potvrdu." }] }]);
    mocks.movements.mockResolvedValue([{ id: "receipt", idempotencyKey: "order-return:SPC-1:item-1:1", warehouseId: "warehouse", createdAt: new Date(), warehouse: { code: "MAG-004", name: "Povrati" } }]);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(html).toContain("Fiskalna refundacija obrađena.");
    expect(html).toContain("Povraćaj novca zahteva ručnu potvrdu.");
    expect(html).not.toContain("Dopuni / ponovi refundaciju");
  });

  it("shows the seven courier returns even when no reclamation return exists", async () => {
    mocks.orders.mockResolvedValue(Array.from({ length: 7 }, (_, index) => returnedOrder(String(index))));
    mocks.count.mockResolvedValue(7);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(mocks.authorize).toHaveBeenCalledWith(["OPS"]);
    for (let index = 0; index < 7; index++) {
      expect(html).toContain(`SPC-${index}`);
      expect(html).toContain(`TRACK-${index}`);
      expect(html).toContain(`/admin/erp/prodajni-nalozi/${index}`);
    }
    expect(html).toMatch(/Vraćene porudžbine<\/p><p[^>]*>7<\/p>/);
    expect(html).toContain("Nema kreiranih reklamacionih povrata.");
    expect(html).not.toContain("Nema kreiranih povrata.");
    expect(html).not.toContain("Primi i proknjiži");
    // Keep both historical/manual order returns and courier-confirmed returns
    // eligible, without counting failed deliveries or replacement shipments.
    const where = { OR: [
      { status: "VRACENO" },
      { shipments: { some: { purpose: "ORDER_DELIVERY", status: "RETURNED", reshipment: null } } },
    ] };
    expect(mocks.orders).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(mocks.count).toHaveBeenCalledWith({ where });
  });

  it("shows manually recorded returns without inventing a courier confirmation", async () => {
    mocks.orders.mockResolvedValue([returnedOrder("manual", [])]);
    mocks.count.mockResolvedValue(1);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(html).toContain("SPC-manual");
    expect(html).toContain("bez kurirske potvrde");
    expect(html).not.toContain("Primi i proknjiži");
  });

  it("keeps multiple returned parcels under one order and uses the full total", async () => {
    const order = returnedOrder("multiple");
    order.shipments.push({ ...order.shipments[0], id: "second", trackingNo: "SECOND-PARCEL" });
    mocks.orders.mockResolvedValue([order]);
    mocks.count.mockResolvedValue(501);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(html.match(/SPC-multiple/g)).toHaveLength(1);
    expect(html).toContain("SECOND-PARCEL");
    expect(html).toContain("Prikazano poslednjih 1 od 501 vraćenih porudžbina.");
  });

  it("preserves the receipt display for posted reclamation returns", async () => {
    mocks.reclamations.mockResolvedValue([{
      id: "claim", number: "R-1-SPC-1", sku: "SKU-1", quantity: 1,
      order: { number: "SPC-1" }, orderItem: { name: "Lampa" },
      shipments: [{ status: "DELIVERED", provider: "MYGLS", trackingNo: "CLAIM-TRACK" }],
    }]);
    mocks.movements.mockResolvedValue([{
      idempotencyKey: "reclamation-return:claim", createdAt: new Date("2026-09-10T10:00:00Z"),
      warehouse: { code: "POV", name: "Povratna roba" },
    }]);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(html).toContain("R-1-SPC-1");
    expect(html).toContain("POV · Povratna roba");
    expect(html).toMatch(/Proknjižene reklamacije<\/p><p[^>]*>1<\/p>/);
    expect(html).toContain("Nema evidentiranih povrata porudžbina.");
    expect(html).not.toContain("Primi i proknjiži");
  });
});
