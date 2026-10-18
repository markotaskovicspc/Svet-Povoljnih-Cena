import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { productLabelsRequest, type ProductLabelArticle } from "@/lib/admin/product-labels";
import { productLabelArticle, productLabelBarcode, renderProductLabelsHtml } from "@/lib/admin/product-labels.server";

const article: ProductLabelArticle = {
  id: "chair", sku: "110082", name: "Kancelarijska stolica FLEX SEAT crna",
  barcode: "8605079400014", importer: "Svet povoljnih cena doo", countryOfOrigin: "Kina", imageUrl: "/chair.png",
};
const imageDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=";

it("keeps exact counts, row-major order and used-sheet offsets across A4 pages", () => {
  const html = renderProductLabelsHtml([{ article, copies: 2, imageDataUri }, { article: { ...article, sku: "000003" }, copies: 1, imageDataUri }], 24);
  expect(html.match(/class="label-sheet"/g)).toHaveLength(2);
  expect(html.match(/box-label empty/g)).toHaveLength(23);
  expect(html.match(/data-sku="110082"/g)).toHaveLength(2);
  expect(html.match(/data-sku="000003"/g)).toHaveLength(1);
  expect(html.indexOf('data-sku="000003"')).toBeGreaterThan(html.lastIndexOf('data-sku="110082"'));
  expect(html).toContain("repeat(3, 70mm)");
  expect(html).toContain("repeat(8, 37.125mm)");
  expect(html).toContain("size: A4 portrait; margin: 0");
});

it("rejects missing data and invalid checksums without inventing a barcode or country", () => {
  expect(() => renderProductLabelsHtml([{ article: { ...article, barcode: "", countryOfOrigin: "" }, copies: 1, imageDataUri }])).toThrow("barkod, zemlja porekla");
  expect(() => productLabelBarcode("8605079400015")).toThrow("Barkod nije ispravan");
  expect(() => productLabelBarcode("x".repeat(100))).toThrow("predugačak");
  expect(productLabelBarcode("SKU-000042")).toContain('role="img"');
});

it("uses the canonical declaration importer, country fallback and leading-zero identifiers", () => {
  const product = productLabelArticle({ id: "a", sku: "200010", name: "Sto", barcode: "0012345678905", countryOfOrigin: "CN", declaration: null, media: [{ url: "/desk.png", thumbUrl: null }] });
  expect(product).toMatchObject({ importer: "Evonek doo", countryOfOrigin: "Kina", barcode: "0012345678905" });
  expect(productLabelArticle({ id: "a", sku: "000001", name: "Sto", barcode: null, countryOfOrigin: null, declaration: "Zemlja porekla: Srbija", media: [] })).toMatchObject({ sku: "000001", barcode: "", countryOfOrigin: "Srbija", imageUrl: "" });
});

it("escapes catalogue text and accepts only embedded, prepared print images", () => {
  const html = renderProductLabelsHtml([{ article: { ...article, name: '<script>alert("x")</script>', sku: 'A" onclick="x' }, copies: 1, imageDataUri }]);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(() => renderProductLabelsHtml([{ article, copies: 1, imageDataUri: "https://example.com/a.png" }])).toThrow("slika nije pripremljena");
});

it("bounds work and rejects duplicate articles, fractions and impossible starting slots", () => {
  const request = { items: [{ productId: "a", copies: 24 }], startPosition: 1 };
  expect(productLabelsRequest.safeParse(request).success).toBe(true);
  for (const invalid of [
    { ...request, items: [{ productId: "a", copies: 481 }] },
    { ...request, items: [{ productId: "a", copies: 1.5 }] },
    { ...request, items: [{ productId: "a", copies: 240 }, { productId: "b", copies: 241 }] },
    { ...request, items: [...request.items, ...request.items] },
    { ...request, startPosition: 25 }, { ...request, startPosition: 0 },
  ]) expect(productLabelsRequest.safeParse(invalid).success).toBe(false);
});

it("writes an optional reference-matched QA page without requiring live services", () => {
  if (!process.env.PRODUCT_LABELS_QA_DIR) return;
  const target = process.env.PRODUCT_LABELS_QA_DIR;
  mkdirSync(target, { recursive: true });
  const source = process.env.PRODUCT_LABELS_QA_PRODUCT ? JSON.parse(readFileSync(process.env.PRODUCT_LABELS_QA_PRODUCT, "utf8")) : article;
  const actualArticle = "importer" in source ? source : productLabelArticle(source);
  const actualImage = process.env.PRODUCT_LABELS_QA_IMAGE ? readFileSync(process.env.PRODUCT_LABELS_QA_IMAGE, "utf8") : imageDataUri;
  const font = readFileSync(join(process.cwd(), "public/documents/spc-pdf-geist-regular.ttf")).toString("base64");
  writeFileSync(join(target, "labels.html"), renderProductLabelsHtml([{ article: actualArticle, copies: 24, imageDataUri: actualImage }], 1, `data:font/ttf;base64,${font}`));
});
