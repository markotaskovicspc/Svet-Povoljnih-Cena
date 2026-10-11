import { z } from "zod";

export const PRODUCT_SET_PREFIX = "set:";
export const isProductSetSku = (sku: string) => sku.startsWith(PRODUCT_SET_PREFIX);
export const productSetSku = (id: string) => `${PRODUCT_SET_PREFIX}${id}`;
export const productSetId = (sku: string) => sku.slice(PRODUCT_SET_PREFIX.length);
export const productSetInputSchema = z.object({
  id: z.string().optional(),
  version: z.string().optional(),
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Adresa koristi mala slova, brojeve i crtice."),
  description: z.string().trim().max(5000),
  active: z.boolean(),
  price: z.number().positive().max(10_000_000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, "Cena ima najviše dve decimale."),
  components: z.array(z.object({ sku: z.string().trim().min(1).max(64).refine(sku => !isProductSetSku(sku), "Set ne može sadržati drugi set."), quantity: z.number().int().min(1).max(99) })).min(2).max(20),
}).superRefine((data, ctx) => {
  if (new Set(data.components.map(c => c.sku)).size !== data.components.length) ctx.addIssue({ code: "custom", path: ["components"], message: "Svaki artikal unesite samo jednom." });
});

/** Exact positive, cent-based per-unit allocation. No lost cent in fiscal lines. */
export function allocateSetPrice(price: number, components: Array<{ quantity: number; weight: number }>): number[] {
  const cents = Math.round(price * 100);
  const quantities = components.map(c => c.quantity);
  if (!Number.isSafeInteger(cents) || cents <= 0 || !components.length || quantities.some(q => !Number.isInteger(q) || q < 1 || q > 99)) throw new Error("Neispravna cena ili količina seta.");
  const weight = components.reduce((sum, c) => sum + Math.max(c.weight, 0.01) * c.quantity, 0);
  const base = components.map(c => Math.max(1, Math.floor(cents * Math.max(c.weight, 0.01) / weight)));
  const maximum = Math.max(...quantities);
  const solve = () => {
    const remainder = cents - base.reduce((sum, p, i) => sum + p * quantities[i], 0);
    if (remainder < 0 || remainder > 200_000) return null;
    const previous = new Int16Array(remainder + 1).fill(-1);
    previous[0] = 0;
    for (let amount = 1; amount <= remainder; amount++) {
      for (let i = 0; i < quantities.length; i++) {
        if (amount >= quantities[i] && previous[amount - quantities[i]] !== -1) { previous[amount] = i; break; }
      }
    }
    if (previous[remainder] === -1) return null;
    const result = [...base];
    for (let amount = remainder; amount > 0;) { const i = previous[amount]; result[i]++; amount -= quantities[i]; }
    return result.map(p => p / 100);
  };
  let result = solve();
  if (!result) {
    // A small downward adjustment makes room for an exact coin combination.
    for (let i = 0; i < base.length; i++) base[i] = Math.max(1, base[i] - maximum);
    result = solve();
  }
  if (!result) throw new Error("Cena seta se ne može tačno raspodeliti na količine u parama. Promenite cenu za jednu paru ili količine komponenti.");
  return result;
}

export type SetDefinition = { id: string; name: string; active: boolean; components: Array<{ sku: string; quantity: number; unitPrice: number }> };
export class ProductSetError extends Error {}
export function expandSetLines(lines: Array<{ sku: string; qty: number; withAssembly?: boolean }>, sets: SetDefinition[]) {
  const byId = new Map(sets.map(s => [s.id, s]));
  const seen = new Set<string>();
  const prices = new Map<string, number>();
  const names = new Map<string, string>();
  const expanded: typeof lines = [];
  const add = (line: typeof lines[number]) => {
    if (seen.has(line.sku)) throw new ProductSetError(`Artikal ${line.sku} je u više stavki. Uklonite samostalan artikal ili set sa istim sastavom iz korpe.`);
    if (line.qty > 99) throw new ProductSetError(`Ukupna količina artikla ${line.sku} u setu može biti najviše 99.`);
    seen.add(line.sku); expanded.push(line);
  };
  for (const line of lines) {
    if (!isProductSetSku(line.sku)) { add(line); continue; }
    const set = byId.get(productSetId(line.sku));
    if (!set?.active || set.components.length < 2) throw new ProductSetError("Set više nije dostupan. Uklonite ga iz korpe i proverite ponudu setova.");
    if (line.withAssembly) throw new ProductSetError("Montaža se za set dogovara sa podrškom pre poručivanja.");
    for (const component of set.components) {
      add({ sku: component.sku, qty: component.quantity * line.qty });
      prices.set(component.sku, component.unitPrice); names.set(component.sku, set.name);
    }
  }
  if (expanded.length > 50) throw new ProductSetError("Korpa može sadržati najviše 50 različitih artikala, uključujući sastav setova.");
  return { lines: expanded, prices, names };
}

export function setStock(components: Array<{ quantity: number; available: number }>): number {
  return components.length ? Math.max(0, Math.min(99, ...components.map(c => Math.floor(Math.max(c.available, 0) / c.quantity)), ...components.map(c => Math.floor(99 / c.quantity)))) : 0;
}
