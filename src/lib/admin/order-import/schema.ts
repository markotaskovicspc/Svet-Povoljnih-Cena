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
export type ImportProduct = { sku: string; name: string };
export type ImportLine = ImportDraft["lines"][number] & { candidates: ImportProduct[] };
export type ImportReview = Omit<ImportDraft, "lines"> & { lines: ImportLine[] };
export function exactImportProduct(line: ImportDraft["lines"][number], candidates: ImportProduct[]) {
  const normalize = (s: string) => s.trim().toLocaleLowerCase("sr-Latn-RS").replace(/\s+/g, " ");
  if (line.sku) return candidates.find(p => normalize(p.sku) === normalize(line.sku)) ?? null;
  const exact = candidates.filter(p => normalize(p.name) === normalize(line.name));
  return exact.length === 1 ? exact[0] : null;
}
