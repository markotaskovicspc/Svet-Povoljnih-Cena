import { beforeEach, expect, it, vi } from "vitest";
import { renderToReadableStream } from "react-dom/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), warehouses: vi.fn(), view: vi.fn(), operations: vi.fn(), analytics: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: mocks.auth }));
vi.mock("@/lib/db", () => ({ db: { warehouse: { findMany: mocks.warehouses }, adminSavedView: { findFirst: mocks.view } } }));
vi.mock("@/lib/admin/dashboard-data", () => ({ getDashboardOperations: mocks.operations }));
vi.mock("@/lib/admin/dashboard-analytics", () => ({ getDashboardAnalytics: mocks.analytics }));
vi.mock("@/components/admin/dashboard-filters", () => ({ DashboardFilters: () => <div>FILTERS_READY</div> }));
vi.mock("@/components/admin/page-header", () => ({ PageHeader: ({title}: {title: string}) => <h1>{title}</h1> }));
import AdminDashboard from "@/app/admin/page";
const data = { orderSummary: { today_count: 1234, today_total: 50, today_shipping: 5, period_count: 1234, period_total: 50, period_shipping: 5 }, fiscalRows: [], reclamationCount: 0, reclamationQuantity: 0, reclamationDeliveredQuantity: 0, topProducts: [], warehouseStockRows: [], incomingRows: [], lowStock: [] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue({ id: "admin" });
  mocks.warehouses.mockResolvedValue([]); mocks.view.mockResolvedValue(null);
});
it("streams heading, filters and operational results while analytics is still pending", async () => {
  const operations = deferred<typeof data>();
  const analytics = deferred<{ visitRows: never[]; conversionRows: never[]; checkedAt: string }>();
  mocks.operations.mockReturnValue(operations.promise); mocks.analytics.mockReturnValue(analytics.promise);
  const stream = await renderToReadableStream(await AdminDashboard({ searchParams: Promise.resolve({}) }));
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  const readUntil = async (marker: string) => {
    while (!html.includes(marker)) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Stream ended before ${marker}`);
      html += decoder.decode(chunk.value);
    }
  };
  try {
    await readUntil("FILTERS_READY");
    expect(html).toContain("Kontrolna tabla");
    expect(html).toContain("Učitavanje poseta i konverzija");
    expect(html).not.toContain("1234");
    operations.resolve(data);
    await readUntil("1234");
    expect(html).not.toContain("Analitika: presek");
    analytics.resolve({ visitRows: [], conversionRows: [], checkedAt: "2026-09-20T00:00:00Z" });
    await readUntil("Analitika: presek");
    expect(mocks.operations).toHaveBeenCalledOnce();
    expect(mocks.analytics).toHaveBeenCalledOnce();
  } finally {
    operations.resolve(data);
    analytics.resolve({ visitRows: [], conversionRows: [], checkedAt: "2026-09-20T00:00:00Z" });
    await reader.cancel();
  }
});
it("does not start any dashboard reads when authorization fails", async () => {
  mocks.auth.mockRejectedValueOnce(new Error("Unauthorized"));
  await expect(AdminDashboard({ searchParams: Promise.resolve({}) })).rejects.toThrow("Unauthorized");
  expect(mocks.warehouses).not.toHaveBeenCalled();
  expect(mocks.operations).not.toHaveBeenCalled();
  expect(mocks.analytics).not.toHaveBeenCalled();
});

it.each([
  { count: 2, quantity: 5, delivered: 200, rate: "2,5%", ratio: "5 reklamiranih / 200 isporučenih komada" },
  { count: 0, quantity: 0, delivered: 200, rate: "0%", ratio: "0 reklamiranih / 200 isporučenih komada" },
  { count: 2, quantity: 5, delivered: 0, rate: "—", ratio: "Nema isporučenih komada u periodu" },
  { count: 2, quantity: 5, delivered: 2, rate: "250%", ratio: "5 reklamiranih / 2 isporučenih komada" },
])("shows a quantity-based reclamation rate ($quantity / $delivered), preserving the case count", async ({ count, quantity, delivered, rate, ratio }) => {
  mocks.operations.mockResolvedValue({ ...data, reclamationCount: count, reclamationQuantity: quantity, reclamationDeliveredQuantity: delivered });
  mocks.analytics.mockResolvedValue({ visitRows: [], conversionRows: [], checkedAt: "2026-09-20T00:00:00Z" });
  const stream = await renderToReadableStream(await AdminDashboard({ searchParams: Promise.resolve({}) }));
  await stream.allReady;
  const html = await new Response(stream).text();
  const card = html.split("Reklamacije u periodu")[1].split("</div>")[0];
  expect(card).toContain(`>${count}</p>`);
  expect(card).toContain(`${rate} reklamiranih komada`);
  expect(card).toContain(ratio);
  expect(card).toContain("Svi magacini");
});
