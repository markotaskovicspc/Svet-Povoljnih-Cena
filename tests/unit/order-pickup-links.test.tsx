import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ batches: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { pickupBatch: { findMany: mocks.batches } } }));
import { OrderPickupLinks } from "@/components/admin/order-pickup-links";
it("shows an explicit empty state for a manual proforma outside picking", async () => {
  mocks.batches.mockResolvedValue([]);
  const html = renderToStaticMarkup(await OrderPickupLinks({ orderId: "manual-order" }));
  expect(html).toContain("još nije učitana ni u jedan picking nalog");
  expect(mocks.batches).toHaveBeenCalledWith(expect.objectContaining({ where: { lines: { some: { orderId: "manual-order", purpose: "ORDER_DELIVERY" } } } }));
});
it("links all matching pickup batches with their statuses", async () => {
  mocks.batches.mockResolvedValue([{ id: "b1", number: "PRE-2026-0052", status: "BOOKED" }, { id: "b2", number: "PRE-2026-0053", status: "DRAFT" }]);
  const html = renderToStaticMarkup(await OrderPickupLinks({ orderId: "manual-order" }));
  expect(html).toContain('href="/admin/erp/preuzimanja/b1"');
  expect(html).toContain('href="/admin/erp/preuzimanja/b2"');
  expect(html).toContain("Proknjižen");
});
