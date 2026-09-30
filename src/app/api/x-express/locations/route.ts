import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { xExpressTownSearchTerms } from "@/lib/x-express/location-search";
import { searchTownAliases } from "@/lib/x-express/town-aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 8) || 8, 1),
    20,
  );
  const searchTerms = xExpressTownSearchTerms(q);
  const select = {
    id: true,
    name: true,
    displayName: true,
    postalCode: true,
    municipalityId: true,
  } as const;
  const orderBy = [{ priority: "asc" as const }, { name: "asc" as const }];

  const [exactNameItems, exactPostalItems, startsWithItems, containsItems] =
    await Promise.all([
      db.xExpressTown.findMany({
        where: {
          active: true,
          name: { equals: q, mode: "insensitive" },
        },
        orderBy,
        take: limit,
        select,
      }),
      /^\d{5}$/.test(q)
        ? db.xExpressTown.findMany({
            where: {
              active: true,
              postalCode: { equals: q },
            },
            orderBy,
            // A postal code can legitimately belong to many X Express towns.
            // Returning only the autocomplete's default eight results can hide
            // the municipality seat (for example Šabac for 15000).
            take: 100,
            select,
          })
        : Promise.resolve([]),
      db.xExpressTown.findMany({
        where: {
          active: true,
          OR: searchTerms.map((term) => ({
            name: { startsWith: term, mode: "insensitive" as const },
          })),
        },
        orderBy,
        take: limit,
        select,
      }),
      db.xExpressTown.findMany({
        where: {
          active: true,
          OR: [
            ...searchTerms.map((term) => ({
              name: { contains: term, mode: "insensitive" as const },
            })),
            { postalCode: { startsWith: q } },
          ],
        },
        orderBy,
        take: limit,
        select,
      }),
    ]);

  // Some postal localities are routed under a municipality in the courier
  // dictionary. Prefer an actual exact record if the provider adds one later.
  const aliases = searchTownAliases(q);
  if (!exactNameItems.length && !exactPostalItems.length && aliases.length) {
    const parents = await db.xExpressTown.findMany({
      where: {active: true, OR: aliases.map(a => ({id: a.townId, name: a.townName}))},
      select,
    });
    const aliasItems = aliases.flatMap(a => {
      const parent = parents.find(p => p.id === a.townId && p.name === a.townName);
      return parent ? [{code: String(parent.id), townId: parent.id, municipalityId: parent.municipalityId,
        name: a.name, postalCode: a.postalCode, displayName: `${a.name} (Zemun) - ${a.postalCode}`,
        aliases: a.aliases}] : [];
    });
    if (aliasItems.length) return NextResponse.json({items: aliasItems});
  }
  const rankedItems = [...startsWithItems, ...containsItems];
  const items = rankedItems
    .filter(
      (item, index) =>
        rankedItems.findIndex((candidate) => candidate.id === item.id) ===
        index,
    )
    .slice(0, limit);

  return NextResponse.json({
    items: (exactNameItems.length
      ? exactNameItems
      : exactPostalItems.length
        ? exactPostalItems
        : items
    ).map((item) => ({
      code: String(item.id),
      townId: item.id,
      municipalityId: item.municipalityId,
      name: item.name,
      displayName: item.displayName ?? item.name,
      postalCode: item.postalCode ?? "",
    })),
  });
}
