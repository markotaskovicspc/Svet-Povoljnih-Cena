import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
const { findUnique, admin } = vi.hoisted(() => ({ findUnique: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { pickupBatch: { findUnique } } }));
vi.mock("@/lib/admin", () => ({ requireAdminAction: admin }));
import PickupLabelsPage from "@/app/admin/erp/preuzimanja/[id]/adresnice/page";

const line = (id: string, sku: string, name: string, packageNo: number) => ({
  id, orderItem: { sku, name }, purpose: "ORDER_DELIVERY", packageNo, packedQuantity: 2,
  order: { number: "POR-2026-0100", status: "POTVRDJENO", cancelledAt: null },
});
beforeEach(() => {
  vi.resetAllMocks();
  findUnique.mockResolvedValue({ id: "batch", number: "PRE-2026-0100", provider: "MYGLS", labelsCreatedAt: new Date(),
    lines: [line("chair", "0020", "Žuta stolica", 1), line("lamp", "0010", "Stona lampa", 2),
      { ...line("cancelled", "CANCEL", "Otkazani artikal", 3), order: { number: "POR-CANCEL", status: "OTKAZANO" } }],
  });
});

it("renders filtered parcels and carries the applied search and sorting to the PDF", async () => {
  const html = renderToStaticMarkup(await PickupLabelsPage({ params: Promise.resolve({ id: "batch" }), searchParams: Promise.resolve({ q: " zuta ", sort: "sku" }) }));
  expect(html).toContain('value="zuta"');
  expect(html).toContain('value="sku" selected=""');
  expect(html).toContain("/labels?q=zuta&amp;sort=sku");
  expect(html).toContain("Otvori PDF za štampu (1)");
  expect(html).toContain("Žuta stolica");
  expect(html).not.toContain("Stona lampa");
  expect(html).not.toContain("Otkazani artikal");
  expect(findUnique.mock.calls[0][0].select.lines.where).toEqual({ deferredAt: null });
  expect(admin).toHaveBeenCalledWith(["OPS"]);
});

it("shows an empty state without a PDF link when no article matches", async () => {
  const html = renderToStaticMarkup(await PickupLabelsPage({ params: Promise.resolve({ id: "batch" }), searchParams: Promise.resolve({ q: "NEPOSTOJECI" }) }));
  expect(html).toContain("Nema adresnica za zadati naziv ili šifru artikla.");
  expect(html).not.toContain("Otvori PDF");
});

it("previews labels in the selected order and keeps uncreated labels unavailable", async () => {
  const render = () => PickupLabelsPage({ params: Promise.resolve({ id: "batch" }), searchParams: Promise.resolve({ sort: "name" }) });
  const html = renderToStaticMarkup(await render());
  expect(html.indexOf("Stona lampa")).toBeLessThan(html.indexOf("Žuta stolica"));
  if (process.env.LABEL_SELECTION_PREVIEW) {
    const cssDir = `${process.env.NEXT_DIST_DIR || ".next"}/static/chunks`;
    const css = readdirSync(cssDir).filter(name => name.endsWith(".css")).map(name => readFileSync(`${cssDir}/${name}`, "utf8")).join("\n");
    mkdirSync("output/playwright/label-selection", { recursive: true });
    writeFileSync("output/playwright/label-selection/index.html", `<!doctype html><html lang="sr-Latn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body>${html}</body></html>`);
  }
  const batch = await findUnique();
  findUnique.mockResolvedValue({ ...batch, labelsCreatedAt: null });
  const unavailable = renderToStaticMarkup(await render());
  expect(unavailable).toContain("Adresnice još nisu kreirane.");
  expect(unavailable).not.toContain("Otvori PDF");
});


it("previews SKU order and includes that order in the print link", async () => {
  const html = renderToStaticMarkup(await PickupLabelsPage({
    params: Promise.resolve({ id: "batch" }),
    searchParams: Promise.resolve({ sort: "sku" }),
  }));
  expect(html.indexOf("Stona lampa")).toBeLessThan(html.indexOf("Žuta stolica"));
  expect(html).toContain('value="sku" selected=""');
  expect(html).toContain("/labels?q=&amp;sort=sku");
});
