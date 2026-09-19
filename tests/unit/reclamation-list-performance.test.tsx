import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), sign: vi.fn(), module: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { reclamation: { findMany: mocks.list } } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn(), withAdminState: vi.fn() }));
vi.mock("@/lib/admin/erp", () => ({ getErpModule: mocks.module }));
vi.mock("@/lib/api/uploads", () => ({ signReclamationPhotoUrls: mocks.sign }));
vi.mock("@/lib/api/reclamations", () => ({}));
vi.mock("@/components/admin/erp-grid", () => ({ ErpGrid: () => null }));
vi.mock("@/components/admin/reclamation-order-search", () => ({ ReclamationOrderFields: () => null }));
vi.mock("@/components/admin/action-form", () => ({ AdminActionForm: () => null }));
vi.mock("next/image", () => ({ default: () => <span>Fotografija</span> }));

import ReclamationsPage from "@/app/admin/erp/reklamacije-dnevnik/page";

it("keeps visible cards, private photos, and detail links without loading hidden shipment/history forms", async () => {
  mocks.list.mockResolvedValue([{
    id: "claim", number: "R-1", orderId: "order", order: { number: "SPC-1" },
    orderItem: { name: "Artikal" }, product: null, sku: "SKU-1", quantity: 1,
    customerFirst: "Test", customerLast: "Kupac", status: "PRIMLJENO",
    description: "Opis reklamacije", photos: [{ id: "photo", url: "private-photo" }],
  }]);
  mocks.module.mockResolvedValue(null);
  mocks.sign.mockResolvedValue(new Map([["private-photo", "https://example.test/signed-photo"]]));
  const html = renderToStaticMarkup(await ReclamationsPage({ searchParams: Promise.resolve({ status: "PRIMLJENO" }) }));
  expect(html).toContain("Opis reklamacije");
  expect(html).toContain('/admin/erp/reklamacije-dnevnik/claim');
  expect(html).toContain("https://example.test/signed-photo");
  expect(html).not.toContain("Sačuvaj magacin");
  const query = mocks.list.mock.calls[0][0];
  expect(query.where).toEqual({ status: "PRIMLJENO" });
  expect(query.include).not.toHaveProperty("shipments");
  expect(query.include).not.toHaveProperty("events");
  expect(query.include).not.toHaveProperty("warehouse");
});
