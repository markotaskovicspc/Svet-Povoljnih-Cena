import { afterEach, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProductLabelsPdf } from "@/lib/admin/product-labels.server";

const png = readFileSync(join(process.cwd(), "public/documents/garantni-list-logo.jpeg"));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([{ copies: 1, start: 1, pages: 1 }, { copies: 24, start: 1, pages: 1 }, { copies: 25, start: 1, pages: 2 }, { copies: 2, start: 24, pages: 2 }])(
  "renders $copies labels from slot $start with exact A4 pages and 100% print scaling",
  async ({ copies, start, pages }) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://labels-qa.supabase.co");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(png, { headers: { "content-type": "image/jpeg" } })));
    const bytes = await buildProductLabelsPdf([{ article: {
      id: "chair", sku: "110082", name: "Kancelarijska stolica FLEX SEAT crna", barcode: "8605079400014",
      countryOfOrigin: "Kina", importer: "Svet povoljnih cena doo",
      imageUrl: "https://labels-qa.supabase.co/storage/v1/object/public/product-media/qa.png",
    }, copies }], start);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(pages);
    expect(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling()).toBe("None");
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 0);
      expect(page.getHeight()).toBeCloseTo(841.89, 0);
    }
  }, 30_000,
);
