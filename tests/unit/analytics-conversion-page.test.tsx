import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pages: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn() }));
vi.mock("@/lib/admin/erp", () => ({ getErpModule: vi.fn().mockResolvedValue(null) }));
vi.mock("@/components/admin/erp-grid", () => ({ ErpGrid: () => null }));
vi.mock("@/components/admin/analytics-filters", () => ({ AnalyticsFilters: () => null }));
vi.mock("@/lib/db", () => ({ db: {
  analyticsEvent: { findMany: vi.fn().mockResolvedValue([]) },
  product: { findMany: vi.fn().mockResolvedValue([{ slug: "stolica", name: "Stolica" }]) },
  $queryRaw: vi.fn().mockResolvedValue([]),
} }));
vi.mock("@/lib/admin/analytics-report.server", async importOriginal => ({
  ...await importOriginal<object>(),
  getPageConversionReport: mocks.pages,
  getDailyVisitsReport: vi.fn().mockResolvedValue([]),
  getAnalyticsFunnelSummary: vi.fn().mockResolvedValue({ visitors: 0, purchasers: 0, purchaseValue: 0, cartBuyers: 0, convertedCartBuyers: 0 }),
}));
import Page from "@/app/admin/erp/posete-konverzije/page";

it("makes the purchase count navigable with the exact selected period, bucket and path", async () => {
  mocks.pages.mockResolvedValue([
    { bucket: "2026-10-01", path: "/p/stolica", pageViews: 3, visits: 2, purchases: 2, purchaseValue: 3000, conversionPct: 100 },
    { bucket: "2026-10-01", path: "/p/bez-poseta", pageViews: 0, visits: 0, purchases: 1, purchaseValue: 100, conversionPct: 0 },
  ]);
  const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ range: "custom", from: "2026-10-01", to: "2026-10-02", group: "month" }) }));
  expect(html).toContain('/admin/erp/posete-konverzije/porudzbine?range=custom&amp;from=2026-10-01&amp;to=2026-10-02&amp;group=month&amp;bucket=2026-10-01&amp;path=%2Fp%2Fstolica');
  expect(html).toContain('aria-label="Prikaži 2 porudžbina za Stolica"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('100%');
  expect(html).toContain('—');
});
