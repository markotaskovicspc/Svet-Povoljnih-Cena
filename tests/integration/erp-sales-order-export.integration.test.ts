import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getOperationalErpRows } from "@/lib/admin/erp-operations";

const runId = `${Date.now()}-${process.pid}`;
const prefix = `ERP-EXPORT-IT-${runId}`;
const periodStart = new Date("2026-07-01T00:00:00.000Z");
const periodEnd = new Date("2026-08-01T00:00:00.000Z");

let warehouseId = "";
let issuedInsideId = "";
let issuedOutsideId = "";
let notIssuedId = "";

beforeAll(async () => {
  const warehouse = await db.warehouse.create({
    data: { code: prefix.slice(0, 40), name: `${prefix} magacin` },
  });
  warehouseId = warehouse.id;

  const [issuedInside, issuedOutside, notIssued] = await Promise.all([
    createOrder("ISSUED-IN", new Date("2026-07-10T10:00:00.000Z")),
    createOrder("ISSUED-OUT", new Date("2026-06-10T10:00:00.000Z")),
    createOrder("NOT-ISSUED", new Date("2026-07-12T10:00:00.000Z")),
  ]);
  issuedInsideId = issuedInside.id;
  issuedOutsideId = issuedOutside.id;
  notIssuedId = notIssued.id;

  await Promise.all([
    createFiscalSale(issuedInside.id, new Date("2026-07-11T09:00:00.000Z"), "IN"),
    createFiscalSale(issuedOutside.id, new Date("2026-06-11T09:00:00.000Z"), "OUT"),
  ]);
});

afterAll(async () => {
  await db.order.deleteMany({ where: { number: { startsWith: prefix } } });
  if (warehouseId) await db.warehouse.deleteMany({ where: { id: warehouseId } });
  await db.$disconnect();
});

describe("sales-order ERP export filters", () => {
  it("filters the existing ERP rows by order period and warehouse", async () => {
    const rows = await getOperationalErpRows("prodajni-nalozi", 100, {
      warehouseId,
      createdFrom: periodStart,
      createdToExclusive: periodEnd,
    });
    const fixtureRows = rows.filter((row) =>
      String(row.values.number).startsWith(prefix),
    );

    expect(new Set(fixtureRows.map((row) => row.detailId))).toEqual(
      new Set([issuedInsideId, notIssuedId]),
    );
    expect(fixtureRows[0]?.values.paymentMethod).toBe("Pouzeće — gotovina");
    expect(fixtureRows[0]?.values.paymentStatus).toBe("Plaća se kuriru");
  });

  it("filters by issued fiscal period without introducing a separate download path", async () => {
    const rows = await getOperationalErpRows("prodajni-nalozi", 100, {
      fiscalIssuedFrom: periodStart,
      fiscalIssuedToExclusive: periodEnd,
      fiscalized: true,
    });
    const fixtureRows = rows.filter((row) =>
      String(row.values.number).startsWith(prefix),
    );

    expect(fixtureRows.map((row) => row.detailId)).toEqual([issuedInsideId]);
    expect(fixtureRows[0]?.values.fiscalized).toBe(true);
  });

  it("AND-combines fiscal status and issue period instead of overwriting either condition", async () => {
    const impossible = await getOperationalErpRows("prodajni-nalozi", 100, {
      fiscalIssuedFrom: periodStart,
      fiscalIssuedToExclusive: periodEnd,
      fiscalized: false,
    });
    const notIssued = await getOperationalErpRows("prodajni-nalozi", 100, {
      createdFrom: periodStart,
      createdToExclusive: periodEnd,
      fiscalized: false,
    });

    expect(
      impossible.filter((row) => String(row.values.number).startsWith(prefix)),
    ).toEqual([]);
    const fixtureNotIssued = notIssued.filter((row) =>
      String(row.values.number).startsWith(prefix),
    );
    expect(fixtureNotIssued.map((row) => row.detailId)).toEqual([notIssuedId]);
    expect(fixtureNotIssued.some((row) => row.detailId === issuedOutsideId)).toBe(false);
  });
});

async function createOrder(suffix: string, createdAt: Date) {
  return db.order.create({
    data: {
      number: `${prefix}-${suffix}`,
      status: "POTVRDJENO",
      channel: "WEB",
      subtotal: 1_000,
      total: 1_000,
      shippingMethod: "KURIR",
      paymentMethod: "POUZECE_GOTOVINA",
      shipFirstName: "QA",
      shipLastName: "Export",
      shipPhone: "+381600000000",
      shipStreet: "Test 1",
      shipCity: "Beograd",
      shipPostalCode: "11000",
      termsAcceptedAt: createdAt,
      createdAt,
      items: {
        create: {
          sku: `${prefix}-SKU`,
          name: `${prefix} artikal`,
          qty: 1,
          unitPriceFull: 1_000,
          unitPriceSale: 1_000,
          warehouseId,
        },
      },
    },
  });
}

async function createFiscalSale(orderId: string, issuedAt: Date, suffix: string) {
  return db.fiscalDocument.create({
    data: {
      orderId,
      kind: "SALE",
      status: "ISSUED",
      source: "MANUAL",
      warehouseId,
      receiptNumber: `${prefix}-${suffix}`,
      idempotencyKey: `${prefix}:fiscal:${suffix}`,
      totalNet: 833.33,
      totalVat: 166.67,
      totalGross: 1_000,
      issuedAt,
    },
  });
}
