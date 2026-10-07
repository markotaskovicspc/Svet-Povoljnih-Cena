import { expect, it } from "vitest";
import { xExpressShipmentStatusSyncWhere } from "@/lib/x-express/sync";

it("rechecks recent failed/delivered shipments for later returns, with a six-hour interval", () => {
  const where = xExpressShipmentStatusSyncWhere(new Date("2026-10-07T12:00:00Z"));
  expect(where).toMatchObject({ provider: "X_EXPRESS", providerShipmentId: { not: null } });
  expect(where.OR).toEqual([
    { status: { notIn: ["DELIVERED", "RETURNED", "FAILED"] } },
    {
      status: { in: ["FAILED", "DELIVERED"] },
      AND: [
        { OR: [{ deliveredAt: { gte: new Date("2026-07-09T12:00:00Z") } }, { deliveredAt: null, createdAt: { gte: new Date("2026-07-09T12:00:00Z") } }] },
        { OR: [{ lastStatusSyncAt: null }, { lastStatusSyncAt: { lt: new Date("2026-10-07T06:00:00Z") } }] },
      ],
    },
  ]);
});
