import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { pickupBatch: { findUnique } } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: vi.fn() }));
vi.mock("@/components/admin/print-page-button", () => ({ PrintPageButton: () => <button>Štampaj picking listu</button> }));
vi.mock("@/components/admin/auto-print-on-load", () => ({ AutoPrintOnLoad: () => null }));
import PickupBatchPrintPage from "@/app/admin/erp/preuzimanja/[id]/stampa/page";
afterEach(() => vi.useRealTimers());
it("renders dated, category-sorted picking with colors, unit totals and separate parcel totals", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-25T10:30:00Z"));
  const item = { id: "chair", sku: "210021", name: "Trpezarijska stolica ALFA", qty: 3, categoryName: "Stolice", color1: "Siva", color2: null,
    product: { barcode: "8601234567890", colorPrimary: "Siva", colorSecondary: null } };
  findUnique.mockResolvedValue({ id: "batch", number: "PRE-2026-0100", provider: "X_EXPRESS", labelsCreatedAt: null,
    pickupDate: new Date("2026-09-26T08:00:00Z"),
    lines: [
      ...[2, 1].map((packedQuantity, i) => ({ id: `parcel-${i}`, lineGroupKey: "order:1", quantity: 3, packedQuantity, orderItem: item })),
      { id: "lamp", lineGroupKey: "order:2", quantity: 1, packedQuantity: 1,
        orderItem: { ...item, id: "lamp", sku: "999999", name: "Stona lampa ZETA", qty: 1, categoryName: "Lampe", product: { barcode: "8609999999999" }, color1: "Bela" } },
      { id: "deferred", lineGroupKey: "order:3", quantity: 1, packedQuantity: 1, deferredAt: new Date(), orderItem: { ...item, sku: "DEFERRED" } },
    ],
  });
  const html = renderToStaticMarkup(await PickupBatchPrintPage({ params: Promise.resolve({ id: "batch" }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Datum štampe");
  expect(html).toContain("25. 9. 2026.");
  expect(html).toContain("12:30");
  expect(html).toContain("Termin preuzimanja");
  expect(html).toContain("Boja: Siva");
  expect(html).toContain("1 × 3 kom");
  expect(html).toContain("8601234567890");
  expect(html).not.toContain("DEFERRED");
  expect(html.indexOf("Stona lampa ZETA")).toBeLessThan(html.indexOf("Trpezarijska stolica ALFA"));
  if (process.env.PICKING_PRINT_PREVIEW) {
    const cssDir = ".next/static/chunks";
    const css = readdirSync(cssDir).filter(name => name.endsWith(".css")).map(name => readFileSync(`${cssDir}/${name}`, "utf8")).join("\n");
    writeFileSync(process.env.PICKING_PRINT_PREVIEW, `<!doctype html><html lang="sr-Latn"><meta charset="utf-8"><style>${css}</style><body>${html}</body></html>`);
  }
});
