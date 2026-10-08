import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolutions: vi.fn(), orders: vi.fn(), count: vi.fn(), reclamations: vi.fn(), reshipments: vi.fn(),
  jobs: vi.fn(), warehouses: vi.fn(), movements: vi.fn(), authorize: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  returnResolution: { findMany: mocks.resolutions },
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
  returnArrivals: [{ parcelNumber: `TRACK-${id}` }],
}]) => ({
  id, number: `SPC-${id}`,
  items: [{ id: `item-${id}`, sku: `SKU-${id}`, name: "Vraćeni artikal", qty: 2 }],
  shipments,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolutions.mockResolvedValue([]);
  mocks.jobs.mockResolvedValue([]);
  mocks.reshipments.mockResolvedValue([]);
  mocks.orders.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.reclamations.mockResolvedValue([]);
  mocks.warehouses.mockResolvedValue([]);
  mocks.movements.mockResolvedValue([]);
});

describe("ERP returns page", () => {
  it("shows each unit's saved parcel next to its receipt control", async () => {
    const order = returnedOrder("parcel");
    mocks.orders.mockResolvedValue([{ ...order, items: [{ ...order.items[0], productId: "product" }], shipments: [{
      id: "shipment-parcel", provider: "X_EXPRESS", trackingNo: "AAA1", packageCount: 2,
      providerParcelNumbers: ["AAA1", "AAA2"], returnArrivals: [{ parcelNumber: "AAA2" }],
      rawCreateResponse: { articleLabels: [
        { Code: "AAA1", sku: "SKU-parcel", packedQuantity: 1 },
        { Code: "AAA2", sku: "SKU-parcel", packedQuantity: 1 },
      ] },
    }] }]);
    const html = renderToStaticMarkup(await ReturnsPage());
    expect(html).toMatch(/Komad 1\/2<\/p><p[^>]*>Paket: AAA1 \(dolazak nije potvrđen\)/);
    expect(html).toMatch(/Komad 2\/2<\/p><p[^>]*>Paket: AAA2 \(dolazak potvrđen\)/);
    expect(html).toContain("Skeniraj paket ili unesi broj porudžbine");
  });

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
  it("shows an expected return before its new goods are loaded into picking", async () => {
    mocks.reshipments.mockResolvedValue([{ id: "r", orderId: "o", batchId: null, batch: null, reason: "Ponovno slanje", order: { number: "SPC-RETRY" }, sourceShipmentId: "s", sourceShipment: { provider: "X_EXPRESS", trackingNo: "OLD", status: "IN_TRANSIT" }, items: [{ id: "ri", sku: "SKU", name: "Sto", quantity: 2, receivedQty: 0 }] }]);
    const html = renderToStaticMarkup(await ReturnsPage({ searchParams: Promise.resolve({ view: "verification" }) }));
    expect(html).toContain("dostupna za učitavanje u picking");
    expect(html).toContain("Primi 1 kom na lager");
    expect(html).not.toContain("/admin/erp/preuzimanja/null");
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
    expect(html).toContain("Aktivni (7)");
    expect(html).toContain("Svi povrati");
    expect(html).not.toContain("Nema kreiranih povrata.");
    expect(html).not.toContain("Primi i proknjiži");
    // Keep both historical/manual order returns and courier-confirmed returns
    // eligible, without counting failed deliveries or replacement shipments.
    const where = { OR: [
      { status: "VRACENO", shipments: { none: { reshipment: { isNot: null } } } },
      { shipments: { some: { purpose: "ORDER_DELIVERY", reshipment: null, OR: [{ status: "RETURNED" }, { returnArrivals: { some: {} } }, { provider: "X_EXPRESS", status: "IN_TRANSIT", providerStatusCode: { in: ["RETURNING", "RET_ASSIGNED", "REVERSE_RETURN", "REVERSE_RETURNING"] } }] } } },
    ] };
    expect(mocks.orders).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(mocks.count).toHaveBeenCalledWith({ where });
  });

  it("shows manually recorded returns without inventing a courier confirmation", async () => {
    mocks.orders.mockResolvedValue([returnedOrder("manual", [])]);
    mocks.count.mockResolvedValue(1);
    const html = renderToStaticMarkup(await ReturnsPage({ searchParams: Promise.resolve({ view: "verification" }) }));
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
    const active = renderToStaticMarkup(await ReturnsPage());
    expect(active).not.toContain("R-1-SPC-1");
    const html = renderToStaticMarkup(await ReturnsPage({ searchParams: Promise.resolve({ view: "completed" }) }));
    expect(html).toContain("R-1-SPC-1");
    expect(html).toContain("POV · Povratna roba");
    expect(html).toContain("Završeni (1)");
    expect(html).toContain("Svi povrati");
    expect(html).not.toContain("Primi i proknjiži");
  });
});

it("moves lost returns out of the active queue and preserves their reason in completed", async () => {
  mocks.orders.mockResolvedValue([returnedOrder("lost")]);
  mocks.resolutions.mockResolvedValue([{ key: "order:lost", reason: "Kurir potvrdio gubitak", createdAt: new Date() }]);
  const active = renderToStaticMarkup(await ReturnsPage());
  expect(active).not.toContain("SPC-lost");
  expect(active).toContain("Nema aktivnih povrata");
  const completed = renderToStaticMarkup(await ReturnsPage({ searchParams: Promise.resolve({ view: "completed" }) }));
  expect(completed).toContain("SPC-lost");
  expect(completed).toContain("Kurir potvrdio gubitak");
  expect(completed).not.toContain("Primi komad");
  expect(completed).not.toContain("Označi kao izgubljenu");
});
it("removes fully received reshipment returns but keeps partial receipts active", async () => {
  const retry = { id: "r", orderId: "o", batchId: null, batch: null, reason: "Ponovno slanje", order: { number: "SPC-RETRY" }, sourceShipmentId: "s", sourceShipment: { provider: "X_EXPRESS", trackingNo: "OLD", status: "RETURNED" }, items: [{ id: "ri", sku: "SKU", name: "Sto", quantity: 2, receivedQty: 2 }] };
  mocks.reshipments.mockResolvedValue([retry]);
  expect(renderToStaticMarkup(await ReturnsPage())).not.toContain("SPC-RETRY");
  const completed = renderToStaticMarkup(await ReturnsPage({ searchParams: Promise.resolve({ view: "completed" }) }));
  expect(completed).toContain("SPC-RETRY");
  expect(completed).not.toContain("Primi 1 kom");
  mocks.reshipments.mockResolvedValue([{ ...retry, items: [{ ...retry.items[0], receivedQty: 1 }] }]);
  expect(renderToStaticMarkup(await ReturnsPage())).toContain("Primi 1 kom");
});

it("separates unconfirmed courier returns without hiding or completing them", async () => {
  const order = returnedOrder("unconfirmed");
  order.shipments[0].returnArrivals = [];
  mocks.orders.mockResolvedValue([order]);
  const active = renderToStaticMarkup(await ReturnsPage());
  expect(active).not.toContain("SPC-unconfirmed");
  expect(active).toContain("Za proveru (1)");
  const verification = renderToStaticMarkup(await ReturnsPage({ searchParams: Promise.resolve({ view: "verification" }) }));
  expect(verification).toContain("SPC-unconfirmed");
  expect(verification).toContain("Dolazak nije potvrđen");
  expect(verification).toContain("Završeni (0)");
});
it("shows all four parcel codes and finds a non-primary GLS code with a leading zero", async () => {
  const order = returnedOrder("four");
  mocks.orders.mockResolvedValue([{ ...order, shipments: [{ ...order.shipments[0], provider: "MYGLS", trackingNo: "9002829867", packageCount: 4,
    providerParcelNumbers: [9002829867, 9002829868, 9002829869, 9002829870], returnArrivals: [{ parcelNumber: "9002829869" }] }],
    items: [{ ...order.items[0], qty: 7, productId: "product" }] }]);
  const html = renderToStaticMarkup(await ReturnsPage({ searchParams: Promise.resolve({ q: "09002829869" }) }));
  for (const code of ["09002829867", "09002829868", "09002829869", "09002829870"]) expect(html).toContain(code);
  expect(html).toContain("Broj paketa: 4");
  expect(html).toContain("Komad 7/7");
  expect(html).not.toContain("Paket 7/7");
  expect(html).toContain("SPC-four");
});
it("keeps unrelated delivered supplier items out of the returned goods", async () => {
  const order = returnedOrder("mixed");
  mocks.orders.mockResolvedValue([{ ...order, shipments: [{ ...order.shipments[0], rawCreateResponse: { assignment: { orderItemIds: ["item-mixed"] } } }], items: [...order.items, { id: "other", sku: "UNRELATED-DELIVERED", name: "Other", qty: 1 }] }]);
  expect(renderToStaticMarkup(await ReturnsPage())).not.toContain("UNRELATED-DELIVERED");
});
