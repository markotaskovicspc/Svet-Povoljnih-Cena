import { z } from "zod";
const field = z.string().max(200);
export const importDraftSchema = z.object({
  firstName: field, lastName: field, phone: field, email: field,
  street: field, houseNumber: field, city: field, postalCode: field,
  paymentMethod: z.enum(["", "POUZECE_GOTOVINA", "POUZECE_KARTICA", "UPLATA_NA_RACUN"]),
  shippingMethod: z.enum(["", "KURIR", "KAMION"]),
  lines: z.array(z.object({ name: field, sku: field, qty: z.number().int().min(1).max(99).nullable(), unitPrice: z.number().min(0).max(99999999).nullable() })).max(50),
  deliveryAmount: z.number().min(0).max(99999999).nullable(), totalAmount: z.number().min(0).max(99999999).nullable(),
  warnings: z.array(z.string().max(300)).max(15),
});
export type ImportDraft = z.infer<typeof importDraftSchema>;
export type ImportProduct = { sku: string; name: string; confidence?: "high" | "medium" | "low"; matchKind?: "exact" | "suggested"; reason?: string; variantLabel?: string; score?: number };
export type ImportLine = ImportDraft["lines"][number] & { candidates: ImportProduct[]; suggested?: boolean };
export type ImportReview = Omit<ImportDraft, "lines"> & { lines: ImportLine[] };
const genericNameWords = new Set(["mini", "rerna", "pec", "stolica", "set", "za", "sa", "i", "od", "kom", "komad", "komada", "w", "kw", "l", "ml", "cm", "mm", "kg", "g"]);
function nameTokens(value: string): string[] {
  return value.toLocaleLowerCase("sr-Latn-RS").replace(/(\d)(\p{L})|(\p{L})(\d)/gu, "$1$3 $2$4").match(/[\p{L}\p{N}]+/gu) ?? [];
}
const normalizedTokens = (value: string) => nameTokens(value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "dj"));
export function importProductSearchTerms(query: string) {
  const tokens = nameTokens(query).filter(word => word.length >= 2);
  const distinctive = tokens.filter(word => !genericNameWords.has(word) && !/^\d+$/.test(word));
  return [...new Set(distinctive.length ? distinctive : tokens)].slice(0, 5);
}
export function withImportDefaults(draft: ImportDraft) {
  return { ...draft, paymentMethod: draft.paymentMethod || "POUZECE_GOTOVINA" as const, shippingMethod: draft.shippingMethod || "KURIR" as const };
}
export function exactImportProduct(line: ImportDraft["lines"][number], candidates: ImportProduct[]) {
  const skuKey = (s: string) => s.trim().toLocaleLowerCase("sr-Latn-RS");
  if (line.sku) return candidates.find(p => skuKey(p.sku) === skuKey(line.sku)) ?? null;
  const words = normalizedTokens(line.name);
  const key = (s: string) => [...normalizedTokens(s)].sort().join(" ");
  const exact = candidates.filter(p => key(p.name) === key(line.name));
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  // A unique named model may include extra descriptions in the chat.
  // Every catalog token, including its color/size/model variant, must be present.
  const matched = candidates.filter(p => {
    const catalog = normalizedTokens(p.name);
    const distinctive = catalog.filter(w => !genericNameWords.has(w) && !/^\d+$/.test(w));
    return new Set(distinctive).size >= 2 && catalog.every(w => words.includes(w));
  });
  return matched.length === 1 ? matched[0] : null;
}
