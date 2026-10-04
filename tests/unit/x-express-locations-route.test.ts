import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, queryRaw } = vi.hoisted(() => ({
  findMany: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    xExpressTown: { findMany },
    $queryRaw: queryRaw,
  },
}));

import { GET } from "@/app/api/x-express/locations/route";

describe("X Express location search", () => {
  beforeEach(() => {
    findMany.mockReset();
    queryRaw.mockReset().mockResolvedValue([]);
  });

  it.each(['Batajnica','11273','Батајница'])('resolves %s to active Zemun routing while preserving locality', async q => {
    findMany.mockImplementation(async ({where}) => where.OR?.some((x: {id?:number}) => x.id===791059)
      ? [{id:791059,name:'Beograd (Zemun)',postalCode:'11080',municipalityId:70157}] : []);
    const result=await(await GET(new Request('http://localhost/api/x-express/locations?q='+encodeURIComponent(q)))).json();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({townId:791059,name:'Batajnica',postalCode:'11273',displayName:'Batajnica (Zemun) - 11273'});
    expect(findMany.mock.calls.at(-1)?.[0].where.active).toBe(true);
  });
  it('does not invent routing when the verified parent is missing', async()=>{
    findMany.mockResolvedValue([]);
    expect(await(await GET(new Request('http://localhost/api/x-express/locations?q=Batajnica'))).json()).toEqual({items:[]});
  });
  it('prefers a provider-specific Batajnica record if one is later added',async()=>{
    findMany.mockResolvedValueOnce([{id:123,name:'Batajnica',postalCode:'11273',municipalityId:70157}]).mockResolvedValue([]);
    const result=await(await GET(new Request('http://localhost/api/x-express/locations?q=Batajnica'))).json();
    expect(result.items[0].townId).toBe(123);
    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it("prioritizes Niš municipalities over towns that only contain 'niš'", async () => {
    findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 792047,
          name: "Niš (Medijana)",
          displayName: "Niš (Medijana) - 18000",
          postalCode: "18000",
          municipalityId: 68,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 123,
          name: "Bavanište",
          displayName: "Bavanište - 26222",
          postalCode: "26222",
          municipalityId: 1,
        },
      ]);

    const response = await GET(
      new Request("http://localhost/api/x-express/locations?q=nis&limit=8"),
    );

    await expect(response.json()).resolves.toEqual({
      items: [
        {
          code: "792047",
          townId: 792047,
          municipalityId: 68,
          name: "Niš (Medijana)",
          displayName: "Niš (Medijana) - 18000",
          postalCode: "18000",
        },
        {
          code: "123",
          townId: 123,
          municipalityId: 1,
          name: "Bavanište",
          displayName: "Bavanište - 26222",
          postalCode: "26222",
        },
      ],
    });
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        active: true,
        name: { equals: "nis", mode: "insensitive" },
      },
    });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        active: true,
        OR: expect.arrayContaining([
          { name: { startsWith: "Niš", mode: "insensitive" } },
        ]),
      },
    });
  });
});

describe('entire courier dictionary without Serbian diacritics',()=>{
 beforeEach(()=>{findMany.mockReset().mockResolvedValue([]);queryRaw.mockReset();});
 it.each([['Cicevac','Ćićevac'],['Mala Mostanica','Mala Moštanica'],['Arandelovac','Aranđelovac'],['Arandjelovac','Aranđelovac'],['Врачар','Beograd (Vračar)']])('finds %s in the provider dictionary',async(q,name)=>{
  queryRaw.mockResolvedValue([{id:50,name,postalCode:'12345',municipalityId:1,displayName:name}]);
  const result=await(await GET(new Request('http://localhost/api/x-express/locations?q='+encodeURIComponent(q)))).json();
  expect(result.items[0]).toMatchObject({townId:50,name});
  const sql=queryRaw.mock.calls[0][0];expect(sql.text).toContain('WHERE active = true');expect(sql.values).toContain(8);
 });
 it('binds hostile text and does not use it as a SQL wildcard',async()=>{
  queryRaw.mockResolvedValue([]);
  await GET(new Request('http://localhost/api/x-express/locations?q='+encodeURIComponent("%_' OR 1=1 --")));
  const sql=queryRaw.mock.calls[0][0];expect(sql.text).toContain('position(');expect(sql.text).not.toContain("OR 1=1 --");expect(sql.values).toContain("%_' or 1=1 --");
 });
});
