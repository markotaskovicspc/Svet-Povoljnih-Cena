import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), orders: vi.fn(), product: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.admin }));
vi.mock("@/lib/db", () => ({ db: { product: { findUnique: mocks.product } } }));
vi.mock("@/lib/admin/analytics-report.server", async importOriginal => ({
  ...await importOriginal<object>(), getPagePurchaseOrders: mocks.orders,
}));
import Page from "@/app/admin/erp/posete-konverzije/porudzbine/page";
const params = { range: "custom", from: "2026-10-01", to: "2026-10-02", group: "month", bucket: "2026-10-01", path: "/p/stolica" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ role: "SUPER" });
  mocks.product.mockResolvedValue({ name: "Trpezarijska stolica" });
  mocks.orders.mockResolvedValue([{ id: "order1", number: "WEB-1", status: "KREIRANO", createdAt: new Date("2026-09-30T22:05:00Z"), quantity: 3, value: 3000, totalCount: 53 }]);
});
it("preserves report filters and renders order links, quantities, and pagination", async () => {
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
  expect(mocks.admin).toHaveBeenCalledWith(["ADS"]);
  expect(mocks.orders).toHaveBeenCalledWith(expect.objectContaining({ fromInput: "2026-10-01", toInput: "2026-10-02" }), "month", "/p/stolica", "2026-10-01", 1);
  expect(html).toContain("Trpezarijska stolica");
  expect(html).toContain("53 porudžbina");
  expect(html).toContain('/admin/erp/prodajni-nalozi/order1');
  expect(html).toContain("Komada artikla");
  expect(html).toContain("3.000 RSD");
  expect(html).toContain("Stranica 1 od 2");
  expect(html).toContain('group=month&amp;path=%2Fp%2Fstolica&amp;bucket=2026-10-01&amp;page=2');
  expect(html).toContain('href="/admin/erp/posete-konverzije?range=custom&amp;from=2026-10-01&amp;to=2026-10-02&amp;group=month"');
});
it("lets marketing see the summary without links to operations-only order details", async () => {
  mocks.admin.mockResolvedValue({ role: "ADS" });
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
  expect(html).toContain("WEB-1");
  expect(html).not.toContain('/admin/erp/prodajni-nalozi/order1');
});
it("does not query orders when authorization fails", async () => {
  mocks.admin.mockRejectedValueOnce(new Error("Forbidden"));
  await expect(Page({ searchParams: Promise.resolve(params) })).rejects.toThrow("Forbidden");
  expect(mocks.orders).not.toHaveBeenCalled();
});
it("shows an empty state and accepts a valid second page", async () => {
  mocks.orders.mockResolvedValue([]);
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ ...params, page: "2" }) }));
  expect(mocks.orders.mock.calls[0][4]).toBe(2);
  expect(html).toContain("Nema porudžbina za izabranu stranicu i period.");
  expect(html).toContain("Prethodna");
});
