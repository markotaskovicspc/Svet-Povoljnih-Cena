import { PGlite } from "@electric-sql/pglite";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { preferExactCityMatches, resolveExactRemoteCity } from "@/components/forms/city-autocomplete";

const { findMany, queryRaw } = vi.hoisted(() => ({ findMany: vi.fn(), queryRaw: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { xExpressTown: { findMany }, $queryRaw: queryRaw } }));
import { GET } from "@/app/api/x-express/locations/route";

const sql = new PGlite();
beforeAll(async () => {
  // Exercise the route's real parameterized SQL against isolated PostgreSQL.
  await sql.exec(`CREATE TABLE "XExpressTown" (
    id integer PRIMARY KEY, name text, "displayName" text, "postalCode" text,
    "municipalityId" integer, priority integer, active boolean
  )`);
  const towns = ["Ćićevac", "Mala Moštanica", "Aranđelovac", "Čačak", "Cacak", "Žitište", "Šabac"];
  for (const [index, name] of towns.entries()) {
    await sql.query('INSERT INTO "XExpressTown" VALUES ($1, $2, $2, $3, 1, 1, true)', [index + 1, name, String(11000 + index)]);
  }
  await sql.exec(`INSERT INTO "XExpressTown" VALUES (99, 'Ćićevac', 'Ćićevac', '99999', 1, 0, false)`);
  queryRaw.mockImplementation(async (query: Prisma.Sql) => (await sql.query(query.text, query.values)).rows);
  findMany.mockImplementation(async ({ where }) => {
    if (where.name?.equals) {
      return (await sql.query('SELECT * FROM "XExpressTown" WHERE active AND lower(name) = lower($1)', [where.name.equals])).rows;
    }
    return [];
  });
});
afterAll(() => sql.close());

async function search(query: string) {
  return (await (await GET(new Request(`http://localhost/api/x-express/locations?q=${encodeURIComponent(query)}`))).json()).items;
}

describe("checkout city search through the courier SQL dictionary", () => {
  it.each([
    ["Cicevac", "Ćićevac"], ["Mala Mostanica", "Mala Moštanica"],
    ["Arandelovac", "Aranđelovac"], ["Arandjelovac", "Aranđelovac"],
    ["Zitiste", "Žitište"], ["Sabac", "Šabac"],
  ])("returns the same provider IDs for %s and %s", async (plain, accented) => {
    const items = await search(plain);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe(accented);
    expect(items[0].townId).not.toBe(99);
    expect(await search(accented)).toEqual(items);
    expect(resolveExactRemoteCity(items, plain)?.townId).toBe(items[0].townId);
  });

  it("does not hide another provider ID when an exact spelling also exists", async () => {
    const items = await search("cacak");
    expect(items.map((item: { townId: number }) => item.townId).sort()).toEqual([4, 5]);
    expect(await search("Čačak")).toEqual(items);
    expect(preferExactCityMatches(items, "cacak")).toEqual(items);
    expect(resolveExactRemoteCity(items, "cacak")).toBeNull();
    expect(resolveExactRemoteCity(items, "Čačak", "11003")?.townId).toBe(4);
  });

  it("treats SQL wildcards and quotes as literal search input", async () => {
    expect(await search("%_' OR 1=1 --")).toEqual([]);
  });
});
