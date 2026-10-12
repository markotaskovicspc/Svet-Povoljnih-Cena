import { db } from "@/lib/db";
import type { CreateOrderInput } from "@/lib/checkout/order-schema";
import { normalizedTownQuery } from "@/lib/x-express/location-search";
import { exactTownAlias } from "@/lib/x-express/town-aliases";

export const IMPORT_TOWN_ERROR = "Izaberite mesto iz kurirskog adresara u podacima kupca, pa proverite obračun ponovo.";

/** Resolve only an exact, unique courier town; never guess from the postal code alone. */
export async function resolveImportAddress(input: CreateOrderInput): Promise<CreateOrderInput | null> {
  if (input.shippingMethod !== "KURIR") return input;
  const ship = input.shipping;
  const towns = await db.xExpressTown.findMany({
    where: { active: true, ...(ship.xExpressTownId ? { id: ship.xExpressTownId } : { postalCode: ship.postalCode }) },
    select: { id: true, name: true, displayName: true },
  });
  const exact = ship.xExpressTownId ? towns : towns.filter(town =>
    [town.name, town.displayName].some(name => name && normalizedTownQuery(name) === normalizedTownQuery(ship.city)),
  );
  let townId = exact.length === 1 ? exact[0].id : null;
  if (!townId && !ship.xExpressTownId && !exact.length) {
    const alias = exactTownAlias(ship.city, ship.postalCode);
    if (alias) {
      const parent = await db.xExpressTown.findMany({ where: { active: true, id: alias.townId, name: alias.townName }, select: { id: true }, take: 2 });
      if (parent.length === 1) townId = parent[0].id;
    }
  }
  return townId ? { ...input, shipping: { ...ship, xExpressTownId: townId } } : null;
}
