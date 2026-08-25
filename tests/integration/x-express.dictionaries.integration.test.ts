import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { syncXExpressDictionaries } from "@/lib/x-express/sync";
import { GET as getXExpressLocations } from "@/app/api/x-express/locations/route";

describe.skipIf(process.env.X_EXPRESS_LIVE_TEST !== "1")(
  "X Express live dictionary persistence",
  () => {
  it(
    "fully synchronizes every provider dictionary twice without duplicates or partial runs",
    async () => {
      const startedAt = new Date();
      const first = await syncXExpressDictionaries();
      expect(first.municipalities).toMatchObject({ ok: true });
      expect(first.towns).toMatchObject({ ok: true });
      expect(first.streets).toMatchObject({ ok: true });
      expect(first.statuses).toMatchObject({ ok: true });
      expect(first.municipalities.count).toBeGreaterThan(100);
      expect(first.towns.count).toBeGreaterThan(4_000);
      expect(first.streets.count).toBeGreaterThan(30_000);
      expect(first.statuses.count).toBeGreaterThan(40);

      const countsAfterFirst = {
        municipalities: await db.xExpressMunicipality.count(),
        towns: await db.xExpressTown.count(),
        streets: await db.xExpressStreet.count(),
        statuses: await db.courierStatusCode.count({
          where: { provider: "X_EXPRESS" },
        }),
        mirroredTowns: await db.courierLocationCode.count({
          where: { provider: "X_EXPRESS" },
        }),
      };
      expect(countsAfterFirst).toEqual({
        municipalities: first.municipalities.count,
        towns: first.towns.count,
        streets: first.streets.count,
        statuses: first.statuses.count,
        mirroredTowns: first.towns.count,
      });

      const second = await syncXExpressDictionaries();
      expect(second).toEqual(first);
      const countsAfterSecond = {
        municipalities: await db.xExpressMunicipality.count(),
        towns: await db.xExpressTown.count(),
        streets: await db.xExpressStreet.count(),
        statuses: await db.courierStatusCode.count({
          where: { provider: "X_EXPRESS" },
        }),
        mirroredTowns: await db.courierLocationCode.count({
          where: { provider: "X_EXPRESS" },
        }),
      };
      expect(countsAfterSecond).toEqual(countsAfterFirst);

      const postalResponse = await getXExpressLocations(
        new Request("https://example.invalid/api/x-express/locations?q=15000&limit=8"),
      );
      expect(postalResponse.status).toBe(200);
      const postalBody = (await postalResponse.json()) as {
        items: Array<{ townId: number; name: string; postalCode: string }>;
      };
      expect(postalBody.items.length).toBeGreaterThan(8);
      expect(postalBody.items).toContainEqual(
        expect.objectContaining({
          townId: 746606,
          name: "Šabac",
          postalCode: "15000",
        }),
      );

      const runs = await db.courierSyncRun.findMany({
        where: { provider: "X_EXPRESS", startedAt: { gte: startedAt } },
        select: {
          status: true,
          recordsRead: true,
          recordsOk: true,
          recordsFail: true,
          errorMessage: true,
          finishedAt: true,
        },
      });
      expect(runs).toHaveLength(8);
      expect(
        runs.every(
          (run) =>
            run.status === "SUCCESS" &&
            run.recordsRead === run.recordsOk &&
            run.recordsFail === 0 &&
            run.errorMessage === null &&
            run.finishedAt !== null,
        ),
      ).toBe(true);
    },
    180_000,
  );
  },
);
