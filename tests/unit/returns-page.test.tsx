import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orders: vi.fn(), count: vi.fn(), reclamations: vi.fn(),
  warehouses: vi.fn(), movements: vi.fn(), authorize: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  order: { findMany: mocks.orders, count: mocks.count },
  reclamation: { findMany: mocks.reclamations },
  warehouse: { findMany: mocks.warehouses },
  stockMovement: { findMany: mocks.movements },
} }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.authorize, withAdminState: vi.fn() }));
vi.mock("@/lib/admin/reclamation-fulfillment.server", () => ({ receiveReclamationReturn: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

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
  mocks.orders.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.reclamations.mockResolvedValue([]);
  mocks.warehouses.mockResolvedValue([]);
  mocks.movements.mockResolvedValue([]);
});

describe("ERP returns page", () => {
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
      { shipments: { some: { purpose: "ORDER_DELIVERY", status: "RETURNED" } } },
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
