import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    xExpressTown: { findMany },
  },
}));

import { GET } from "@/app/api/x-express/locations/route";

describe("X Express location search", () => {
  beforeEach(() => {
    findMany.mockReset();
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
