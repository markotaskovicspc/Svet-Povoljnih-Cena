import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ananasReturnShipments } from "@/lib/ananas/returns";
const m = vi.hoisted(() => ({ orders: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { ananasOrder: { findMany: m.orders } } }));
import { AnanasReturns } from "@/components/admin/ananas-returns";
beforeEach(() => {
  vi.clearAllMocks();
  m.orders.mockResolvedValue([{ id: "A-B", shipments: [{ suborderId: "A-B-DS-1", status: "RETURN_TO_SELLER", carrierName: "D Express", quantity: 2 }], lastCheckedAt: new Date("2026-10-20T10:00:00Z") }]);
});
describe("Ananas return references", () => {
  it("keeps return shipment references distinct from tracking numbers and stock receipts", () => {
    const values = [{ suborderId: "A-B-DS-1", status: "RETURN_TO_SELLER", quantity: 1 }, { suborderId: "C-D-FBA-1", status: "RETURNED_TO_SELLER", quantity: 1 }, { suborderId: "E-F-1", status: "DELIVERED", quantity: 1 }, { suborderId: "BAD", status: "RETURN_TO_SELLER", quantity: "bad" }];
    expect(ananasReturnShipments(values).map(s => s.suborderId)).toEqual(["A-B-DS-1", "C-D-FBA-1"]);
    expect(ananasReturnShipments(null)).toEqual([]);
  });
  it("shows reference, carrier and status to warehouse without an ERP-only link or receipt action", async () => {
    const html = renderToStaticMarkup(await AnanasReturns({ query: "A-B-DS-1", warehouseMode: true }));
    expect(html).toContain("A-B-DS-1");
    expect(html).toContain("D Express");
    expect(html).toContain("nije broj povratne adresnice");
    expect(html).not.toContain("/admin/erp/prodajni-nalozi");
    expect(html).not.toContain("Potvrdi prijem");
    expect(m.orders.mock.calls[0][0].where.AND[1].OR).toContainEqual({ shipments: { array_contains: [{ suborderId: "A-B-DS-1" }] } });
  });
  it("links office to the mirrored order and explains unmatched lookups", async () => {
    const html = renderToStaticMarkup(await AnanasReturns({ query: "", warehouseMode: false }));
    expect(html).toContain("/admin/erp/prodajni-nalozi/ananas-A-B");
    m.orders.mockResolvedValue([]);
    expect(renderToStaticMarkup(await AnanasReturns({ query: "UNKNOWN", warehouseMode: true }))).toContain("Nema uvezenog Ananas povrata");
  });
});
