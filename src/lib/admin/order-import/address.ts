import { db } from "@/lib/db";
import type { CreateOrderInput } from "@/lib/checkout/order-schema";
import { matchImportTown } from "./towns";
import { exactTownAlias } from "@/lib/x-express/town-aliases";

export const IMPORT_TOWN_ERROR = "Mesto nije jednoznačno prepoznato. Proverite naziv mesta i poštanski broj u podacima kupca, pa izaberite odgovarajuće mesto iz ponuđene liste.";

/** Resolve only an exact, unique courier town; never guess from the postal code alone. */
export async function resolveImportAddress(input: CreateOrderInput): Promise<CreateOrderInput | null> {
  if (input.shippingMethod !== "KURIR") return input;
  const ship = input.shipping;
  if (!ship.xExpressTownId) {
    const locality = await resolveImportAlias(ship.city, ship.postalCode);
    return locality ? { ...input, shipping: { ...ship, ...locality } } : null;
  }
  const towns = await db.xExpressTown.findMany({
    where: { active: true, id: ship.xExpressTownId },
    select: { id: true, name: true, postalCode: true },
  });
  const town = towns.length === 1 ? towns[0] : null;
  if (!town) return null;
  const alias = exactTownAlias(ship.city, ship.postalCode);
  // Revalidate the reviewed address; never silently change it during creation.
  const expected = alias && alias.townId === town.id && alias.townName === town.name
    ? alias : { name: town.name, postalCode: town.postalCode };
  return expected.name === ship.city && expected.postalCode === ship.postalCode ? input : null;
}

/** Match against the entire active dictionary, independent of GPT's postcode. */
export async function importTowns() {
  return db.xExpressTown.findMany({ where: { active: true }, select: { id: true, name: true, displayName: true, postalCode: true } });
}
export async function resolveImportAlias(city: string, postalCode = "") {
  return matchImportTown(await importTowns(), city, postalCode);
}
