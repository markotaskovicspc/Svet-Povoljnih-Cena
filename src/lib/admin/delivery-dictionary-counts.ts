import "server-only";
import { db } from "@/lib/db";

type DictionaryCounts = {
  xTowns: number;
  xStreets: number;
  xStatuses: number;
  glsDeliveryPoints: number;
  glsLocations: number;
};

/** A single round trip; these are live counts, not cached configuration. */
export async function getDeliveryDictionaryCounts(): Promise<DictionaryCounts> {
  const [counts] = await db.$queryRaw<DictionaryCounts[]>`
    SELECT
      (SELECT count(*)::int FROM "XExpressTown" WHERE "active" = true) AS "xTowns",
      (SELECT count(*)::int FROM "XExpressStreet" WHERE "active" = true AND "deleted" = false) AS "xStreets",
      (SELECT count(*)::int FROM "CourierStatusCode" WHERE "provider" = 'X_EXPRESS' AND "active" = true) AS "xStatuses",
      (SELECT count(*)::int FROM "CourierDeliveryPoint" WHERE "provider" = 'MYGLS' AND "active" = true) AS "glsDeliveryPoints",
      (SELECT count(*)::int FROM "CourierLocationCode" WHERE "provider" = 'MYGLS' AND "active" = true) AS "glsLocations"
  `;
  if (!counts) throw new Error("Brojači kurirskih šifarnika nisu učitani.");
  return counts;
}
