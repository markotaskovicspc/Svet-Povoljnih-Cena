import "server-only";

import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import JsBarcode from "jsbarcode";
import sharp from "sharp";
import { PDFDocument, PrintScaling } from "pdf-lib";
import { buildProductDeclaration, declarationImporterForSku } from "@/lib/product-declaration";
import { getManagedProductMediaStorageKey, resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { renderPrintHtmlPdf } from "@/lib/pdf/print-html";
import { missingProductLabelFields, PRODUCT_LABELS_PER_SHEET, type ProductLabelArticle } from "./product-labels";

export const productLabelSelect = {
  id: true, sku: true, name: true, barcode: true, countryOfOrigin: true, declaration: true,
  media: { where: { kind: "IMAGE" as const, syncStatus: "READY" as const }, take: 1, orderBy: { order: "asc" as const }, select: { url: true, thumbUrl: true } },
} as const;

type LabelProduct = {
  id: string; sku: string; name: string; barcode: string | null;
  countryOfOrigin: string | null; declaration: string | null;
  media: { url: string; thumbUrl: string | null }[];
};

export class ProductLabelError extends Error {}

export function productLabelArticle(product: LabelProduct): ProductLabelArticle {
  const declaration = buildProductDeclaration({
    sku: product.sku, name: product.name, countryOfOrigin: product.countryOfOrigin,
    manualDeclaration: product.declaration,
  });
  return {
    id: product.id, sku: product.sku, name: product.name,
    barcode: product.barcode?.trim() ?? "",
    importer: declarationImporterForSku(product.sku),
    countryOfOrigin: declaration.match(/^Zemlja porekla: (.+)$/m)?.[1] ?? "",
    imageUrl: resolveSupabaseStorageUrl(product.media[0]?.thumbUrl || product.media[0]?.url),
  };
}

function escape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Keep vector bars and quiet zones; never substitute the SKU for a missing EAN. */
export function productLabelBarcode(barcode: string) {
  const encoded: { encodings?: { data: string }[] } = {};
  let valid = false;
  try {
    JsBarcode(encoded, barcode, {
      format: /^\d{13}$/.test(barcode) ? "EAN13" : /^\d{8}$/.test(barcode) ? "EAN8" : "CODE128",
      displayValue: false, valid: result => { valid = result; },
    });
  } catch { /* Report the same actionable error for all invalid barcode formats. */ }
  const bits = valid ? encoded.encodings?.map(part => part.data).join("") : null;
  if (!bits || bits.length + 22 > 220) {
    throw new ProductLabelError("Barkod nije ispravan ili je predugačak za čitljivu nalepnicu. Ispravite ga u kartici artikla.");
  }
  const bars = [...bits].map((bit, index) => bit === "1" ? `<rect x="${index + 11}" y="0" width="1" height="36"/>` : "").join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bits.length + 22} 36" preserveAspectRatio="none" role="img" aria-label="Barkod ${escape(barcode)}"><rect width="100%" height="36" fill="white"/><g fill="black">${bars}</g></svg>`;
}

export type ProductLabelPrintItem = { article: ProductLabelArticle; copies: number; imageDataUri: string };

/** A4 portrait, 70 x 37.125 mm, row-major order, 3 columns and 8 rows. */
export function renderProductLabelsHtml(items: readonly ProductLabelPrintItem[], startPosition = 1, fontDataUri?: string) {
  const labels: string[] = Array.from({ length: startPosition - 1 }, () => '<section class="box-label empty" aria-hidden="true"></section>');
  for (const { article, copies, imageDataUri } of items) {
    const missing = missingProductLabelFields(article);
    if (missing.length) throw new ProductLabelError(`${article.sku}: nedostaje ${missing.join(", ")}. Dopunite karticu artikla.`);
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(imageDataUri)) {
      throw new ProductLabelError(`${article.sku}: slika nije pripremljena za štampu.`);
    }
    const barcode = productLabelBarcode(article.barcode);
    const label = `<section class="box-label" data-sku="${escape(article.sku)}">
      <div class="label-main"><img class="article-image" src="${imageDataUri}" alt=""/>
        <div class="article-code"><div class="article-name">${escape(article.name)}</div>${barcode}<div class="barcode-number">${escape(article.barcode)}</div></div>
      </div>
      <div class="importer">Uvoznik za Srbiju: ${escape(article.importer)}</div>
      <div class="label-footer"><span>Zemlja porekla: ${escape(article.countryOfOrigin)}</span><strong>${escape(article.sku)}</strong></div>
    </section>`;
    for (let copy = 0; copy < copies; copy++) labels.push(label);
  }
  const sheets: string[] = [];
  for (let index = 0; index < labels.length; index += PRODUCT_LABELS_PER_SHEET) {
    sheets.push(`<main class="label-sheet">${labels.slice(index, index + PRODUCT_LABELS_PER_SHEET).join("")}</main>`);
  }
  return `<!DOCTYPE html><html lang="sr-Latn"><head><meta charset="utf-8"/><title>Nalepnice za kutije</title><style>
    ${fontDataUri ? `@font-face { font-family: Label; src: url('${fontDataUri}') format('truetype'); font-weight: 400; }` : ""}
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 210mm; background: white; color: black; font-family: Label, Arial, sans-serif; }
    .label-sheet { display: grid; grid-template-columns: repeat(3, 70mm); grid-template-rows: repeat(8, 37.125mm); width: 210mm; height: 297mm; break-after: page; }
    .label-sheet:last-child { break-after: auto; }
    .box-label { width: 70mm; height: 37.125mm; padding: 3mm 3mm 1mm; break-inside: avoid; }
    .label-main { display: grid; grid-template-columns: 15mm 1fr; gap: 1mm; align-items: center; }
    .article-image { width: 15mm; height: 17mm; object-fit: contain; }
    .article-code { min-width: 0; text-align: center; }
    .article-name { display: flex; align-items: end; justify-content: center; height: 6mm; margin-bottom: 1mm; font-size: 6.5pt; line-height: 1.1; overflow-wrap: anywhere; }
    .article-code svg { display: block; width: 48mm; height: 7mm; }
    .barcode-number { margin-top: .5mm; font-size: 8pt; line-height: 1.1; font-weight: 700; }
    .importer { margin-top: 1mm; text-align: center; font-size: 6.5pt; line-height: 1.2; overflow-wrap: anywhere; }
    .label-footer { display: flex; align-items: center; justify-content: space-between; gap: 1mm; margin-top: 1mm; }
    .label-footer span { font-size: 6.5pt; line-height: 1.2; overflow-wrap: anywhere; }
    .label-footer strong { font-size: 12pt; line-height: 1.1; overflow-wrap: anywhere; text-align: right; }
    @media screen { .label-sheet { outline: 1px solid #ddd; } }
  </style></head><body>${sheets.join("")}</body></html>`;
}

async function loadLabelImage(article: ProductLabelArticle, signal: AbortSignal) {
  try {
    let bytes: Buffer;
    if (article.imageUrl.startsWith("/") && !article.imageUrl.startsWith("//")) {
      const publicRoot = resolve(process.cwd(), "public");
      const imagePath = resolve(publicRoot, `.${decodeURIComponent(article.imageUrl)}`);
      if (!imagePath.startsWith(publicRoot + sep)) throw new Error("Invalid image path");
      bytes = await readFile(imagePath);
    } else {
      // Only the public product-media bucket is a source for catalogue labels.
      if (!getManagedProductMediaStorageKey(article.imageUrl)) throw new Error("Unmanaged image");
      const response = await fetch(article.imageUrl, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]) });
      if (!response.ok || Number(response.headers.get("content-length")) > 10_000_000) throw new Error("Image unavailable");
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.length > 10_000_000) throw new Error("Image too large");
    const image = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .resize(220, 250, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).png().toBuffer();
    return `data:image/png;base64,${image.toString("base64")}`;
  } catch {
    throw new ProductLabelError(`${article.sku}: slika nije dostupna za štampu. Proverite sliku u kartici artikla.`);
  }
}

export async function buildProductLabelsPdf(items: readonly { article: ProductLabelArticle; copies: number }[], startPosition: number) {
  for (const { article } of items) {
    const missing = missingProductLabelFields(article);
    if (missing.length) throw new ProductLabelError(`${article.sku}: nedostaje ${missing.join(", ")}. Dopunite karticu artikla.`);
    productLabelBarcode(article.barcode);
  }
  const rendered: ProductLabelPrintItem[] = [];
  const imageDeadline = AbortSignal.timeout(12_000);
  for (let index = 0; index < items.length; index += 4) {
    const batch = await Promise.all(items.slice(index, index + 4).map(async item => ({
      ...item, imageDataUri: await loadLabelImage(item.article, imageDeadline),
    })));
    rendered.push(...batch);
  }
  const font = await readFile(join(process.cwd(), "public/documents/spc-pdf-geist-regular.ttf"));
  const html = renderProductLabelsHtml(rendered, startPosition, `data:font/ttf;base64,${font.toString("base64")}`);
  let bytes: Buffer;
  try { bytes = await renderPrintHtmlPdf(html, { productLabels: true }); }
  catch (error) {
    const overflow = error instanceof Error ? error.message.match(/PRINT_LABEL_OVERFLOW:([^\s]+)/) : null;
    if (overflow) throw new ProductLabelError(`${overflow[1]}: podaci ne staju čitljivo na nalepnicu. Skratite naziv u kartici artikla.`);
    throw error;
  }
  const document = await PDFDocument.load(bytes);
  document.setTitle("Nalepnice za kutije - A4 24 nalepnice");
  document.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  return Buffer.from(await document.save());
}
