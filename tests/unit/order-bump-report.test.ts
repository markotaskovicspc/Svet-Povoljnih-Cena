import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { beforeAll, afterAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, databaseIdentifier: (name: string) => Prisma.raw(`"${name}"`) }));
import { orderBumpReportQuery, type OrderBumpReportRow } from "@/lib/admin/order-bump-report.server";

const sql = new PGlite();
const period = { start: new Date("2026-10-01T00:00:00Z"), endExclusive: new Date("2026-11-01T00:00:00Z") };
async function report() {
  const query = orderBumpReportQuery(period);
  return (await sql.query<OrderBumpReportRow>(query.text, query.values)).rows;
}

beforeAll(async () => {
  await sql.exec(`
    CREATE TABLE "Order" (id text PRIMARY KEY, status text, channel text, "createdAt" timestamp,
      subtotal numeric, "voucherDiscount" numeric, "firstPurchaseDiscount" numeric, "savedCardDiscount" numeric);
    CREATE TABLE "OrderItem" ("orderId" text, sku text, name text, qty int, "unitPriceSale" numeric,
      "orderBumpOfferId" text, "orderBumpSourceSku" text, "orderBumpQuantity" int);
    INSERT INTO "Order" VALUES
      ('delivered','ISPORUCENO','WEB','2026-10-12',10000,1000,0,0),
      ('pending','KREIRANO','WEB','2026-10-12',3000,0,0,0),
      ('cancelled','OTKAZANO','WEB','2026-10-12',3000,0,0,0),
      ('returned','VRACENO','WEB','2026-10-12',3000,0,0,0),
      ('marketplace','ISPORUCENO','ANANAS','2026-10-12',3000,0,0,0),
      ('old','ISPORUCENO','WEB','2026-09-30',3000,0,0,0);
    INSERT INTO "OrderItem" VALUES
      ('delivered','TABLE','Table',3,3000,'table-offer','CHAIR',1),
      ('delivered','LAMP','Lamp',1,1000,'lamp-offer','TABLE',1),
      ('delivered','CHAIR','Chair',2,2500,null,null,0),
      ('pending','TABLE','Table',1,3000,'table-offer','CHAIR',3),
      ('cancelled','TABLE','Table',1,3000,'table-offer','CHAIR',1),
      ('returned','TABLE','Table',1,3000,'table-offer','CHAIR',1),
      ('marketplace','TABLE','Table',1,3000,'table-offer','CHAIR',1),
      ('old','TABLE','Table',1,3000,'table-offer','CHAIR',1);
  `);
}, 30_000);
afterAll(() => sql.close());

it("counts each order once, excludes cancelled/returned/non-web orders and attributes only bump units after discounts", async () => {
  const rows = await report();
  expect(rows.find(row => row.total === 1)).toMatchObject({ orders: 2, delivered: 1, excluded: 2, units: 3, revenue: 6600, deliveredRevenue: 3600 });
  expect(rows.find(row => row.sku === "TABLE")).toMatchObject({ orders: 2, delivered: 1, excluded: 2, units: 2, revenue: 5700 });
  expect(rows.some(row => row.sku === "CHAIR")).toBe(false);
});

it("returns an explicit zero total when no purchases fall inside the date range", async () => {
  const query = orderBumpReportQuery({ start: new Date("2027-01-01"), endExclusive: new Date("2027-02-01") });
  const rows = (await sql.query<OrderBumpReportRow>(query.text, query.values)).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ total: 1, orders: 0, delivered: 0, excluded: 0, units: 0, revenue: 0 });
});
