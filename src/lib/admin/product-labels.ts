import { z } from "zod";

export const PRODUCT_LABELS_PER_SHEET = 24;
export const MAX_PRODUCT_LABELS = 480;

export type ProductLabelArticle = {
  id: string;
  sku: string;
  name: string;
  barcode: string;
  importer: string;
  countryOfOrigin: string;
  imageUrl: string;
};

export const productLabelsRequest = z.object({
  items: z.array(z.object({
    productId: z.string().min(1).max(100),
    copies: z.number().int().min(1).max(MAX_PRODUCT_LABELS),
  })).min(1).max(100),
  startPosition: z.number().int().min(1).max(PRODUCT_LABELS_PER_SHEET).default(1),
}).superRefine(({ items }, ctx) => {
  if (items.reduce((sum, item) => sum + item.copies, 0) > MAX_PRODUCT_LABELS) {
    ctx.addIssue({ code: "custom", message: `Najviše ${MAX_PRODUCT_LABELS} nalepnica po štampi.` });
  }
  if (new Set(items.map(item => item.productId)).size !== items.length) {
    ctx.addIssue({ code: "custom", message: "Artikal je izabran više puta. Promenite broj nalepnica u njegovom redu." });
  }
});

export function missingProductLabelFields(article: ProductLabelArticle) {
  return [
    !article.barcode && "barkod",
    !article.countryOfOrigin && "zemlja porekla",
    !article.imageUrl && "slika",
  ].filter((field): field is string => Boolean(field));
}
