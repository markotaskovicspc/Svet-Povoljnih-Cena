import { db } from "@/lib/db";
import type { CreateOrderInput } from "@/lib/checkout/order-schema";
import { normalizedTownQuery } from "@/lib/x-express/location-search";
import { exactTownAlias } from "@/lib/x-express/town-aliases";

export const IMPORT_TOWN_ERROR = "Mesto nije jednoznačno prepoznato. Proverite naziv mesta i poštanski broj u podacima kupca, pa izaberite odgovarajuće mesto iz ponuđene liste.";

/** Resolve only an exact, unique courier town; never guess from the postal code alone. */
export async function resolveImportAddress(input: CreateOrderInput): Promise<CreateOrderInput | null> {
  if (input.shippingMethod !== "KURIR") return input;
  const ship = input.shipping;
  const locality = !ship.xExpressTownId ? await resolveImportAlias(ship.city) : null;
  if (locality) return { ...input, shipping: { ...ship, ...locality } };
  const towns = await db.xExpressTown.findMany({
    where: { active: true, ...(ship.xExpressTownId ? { id: ship.xExpressTownId } : { postalCode: ship.postalCode }) },
    select: { id: true, name: true, displayName: true },
  });
  const exact = ship.xExpressTownId ? towns : towns.filter(town =>
    [town.name, town.displayName].some(name => name && normalizedTownQuery(name) === normalizedTownQuery(ship.city)),
  );
  const townId = exact.length === 1 ? exact[0].id : null;
  return townId ? { ...input, shipping: { ...ship, xExpressTownId: townId } } : null;
}

/** Exact verified locality names only; the corrected address remains visible for review. */
export async function resolveImportAlias(city: string) {
  const alias = exactTownAlias(city);
  if (!alias) return null;
  const parent = await db.xExpressTown.findMany({ where: { active: true, id: alias.townId, name: alias.townName }, select: { id: true }, take: 2 });
  return parent.length === 1 ? { city: alias.name, postalCode: alias.postalCode, xExpressTownId: parent[0].id } : null;
}
