import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/db")>(), db: {} }));
const costAt = vi.hoisted(() => vi.fn());
vi.mock("@/lib/admin/fiscal-cogs.server", () => ({ loadFiscalCogs: vi.fn(async () => costAt) }));
import { loadReceiptStockBaselines, receiptStockBaselineQuery } from "@/lib/admin/inbound-inventory-history.server";

const sql = new PGlite();
const at = new Date("2025-10-20T22:00:00Z"); // 21 October in Belgrade.
const query = async (q: Prisma.Sql) => (await sql.query(q.text, q.values)).rows;
const baseline = () => query(receiptStockBaselineQuery(["p"], at, "current"));
beforeAll(async () => {
  await sql.exec(`
    CREATE TABLE "Product" (id text PRIMARY KEY, sku text, stock int, cogs numeric);
    CREATE TABLE "StockMovement" (id text, "productId" text, qty int, kind text, "createdAt" timestamp, "idempotencyKey" text, "warehouseId" text DEFAULT 'ananas');
    CREATE TABLE "WarehouseStock" ("productId" text, "warehouseId" text, qty int);
    CREATE TABLE "InboundInvoice" (id text, "purchaseOrderId" text, "invoiceDate" timestamp, "lockedAt" timestamp, status text);
    CREATE TABLE "PurchaseOrderItem" ("purchaseOrderId" text, "productId" text);
  `);
});
beforeEach(async () => {
  await sql.exec(`TRUNCATE "Product", "StockMovement", "InboundInvoice", "PurchaseOrderItem", "WarehouseStock";
    INSERT INTO "Product" VALUES ('p','110120',-98,99);
    INSERT INTO "WarehouseStock" VALUES ('p','ananas',-98);
    INSERT INTO "StockMovement" VALUES ('sale','p',-98,'SALE_RESERVATION','2026-01-01','ananas-fiscal:later:line');`);
  costAt.mockReturnValue({ unitCogs: 52.7, estimated: false });
});
afterAll(() => sql.close());

describe("receipt stock before its Belgrade calendar day", () => {
  it("reverses later Ananas sales instead of rejecting today's negative stock", async () => {
    expect(await baseline()).toEqual([{ productId: "p", sku: "110120", stock: 0, currentCogs: 99, hasLaterReceipt: false }]);
  });
  it("does not reuse an earlier zero balance for a later receipt date", async () => {
    const result = await loadReceiptStockBaselines(["p"], new Date("2026-10-30"), "current", { $queryRaw: query } as unknown as Prisma.TransactionClient);
    expect(result.get("p")).toMatchObject({ stock: -98, error: expect.stringContaining("2026-10-30 je negativno (-98)") });
  });
  it("counts an earlier backdated receipt by its document day, preserving legacy opening quantities", async () => {
    await sql.exec(`UPDATE "Product" SET stock=-48;
      INSERT INTO "StockMovement" VALUES ('receipt','p',50,'PURCHASE_RECEIPT','2026-09-01','purchase-order:prior:receive:item');
      INSERT INTO "InboundInvoice" VALUES ('prior','prior','2025-10-02 22:00','2026-09-01','POSTED');
      INSERT INTO "InboundInvoice" VALUES ('cancelled','prior','2025-10-02 22:00','2026-09-01','CANCELLED');`);
    expect((await baseline())[0]).toMatchObject({ stock: 50 });
  });
  it("includes an already posted receipt on the same day and excludes this receipt on retries", async () => {
    await sql.exec(`UPDATE "Product" SET stock=192;
      INSERT INTO "StockMovement" VALUES
        ('prior','p',50,'PURCHASE_RECEIPT','2026-09-01','purchase-order:prior:receive:a'),
        ('self','p',240,'PURCHASE_RECEIPT','2026-10-30','purchase-order:current:receive:b');
      INSERT INTO "InboundInvoice" VALUES
        ('prior','prior','2025-10-21','2026-09-01','POSTED'),
        ('self','current','2025-10-20 22:00','2026-10-30','POSTED');`);
    expect((await baseline())[0]).toMatchObject({ stock: 50, hasLaterReceipt: false });
  });
  it("uses local midnight and does not include sales later on the receipt day", async () => {
    await sql.exec(`UPDATE "Product" SET stock=-101;
      INSERT INTO "StockMovement" VALUES
        ('before','p',-1,'SALE_RESERVATION','2025-10-20 21:59:59',NULL),
        ('same-day','p',-2,'SALE_RESERVATION','2025-10-20 22:00:00',NULL);`);
    expect((await baseline())[0]).toMatchObject({ stock: -1 });
  });
  it("keeps real historical negatives visible and blocks their COGS", async () => {
    await sql.exec(`UPDATE "Product" SET stock=-99;`);
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    const result = await loadReceiptStockBaselines(["p"], at, "current", tx);
    expect(result.get("p")).toMatchObject({ stock: -1, error: expect.stringContaining("negativno (-1)") });
  });
  it("keeps legacy opening stock when there are no movements and flags missing historical cost", async () => {
    await sql.exec(`TRUNCATE "StockMovement"; UPDATE "Product" SET stock=25;`);
    costAt.mockReturnValue({ unitCogs: null, estimated: false });
    const result = await loadReceiptStockBaselines(["p"], at, "current", { $queryRaw: query } as unknown as Prisma.TransactionClient);
    expect(result.get("p")).toMatchObject({ stock: 25, cogs: null, error: expect.stringContaining("Nedostaje nabavna cena") });
  });
  it("does not value zero stock with a later cost observation", async () => {
    costAt.mockReturnValue({ unitCogs: null, estimated: false });
    const result = await loadReceiptStockBaselines(["p"], at, "current", { $queryRaw: query } as unknown as Prisma.TransactionClient);
    expect(result.get("p")).toMatchObject({ stock: 0, cogs: null, error: null });
    expect(costAt).not.toHaveBeenCalled();
  });
  it("requires controlled recalculation instead of overwriting a newer posted receipt cost", async () => {
    await sql.exec(`INSERT INTO "InboundInvoice" VALUES ('newer','later','2025-10-21 22:00','2026-10-01','POSTED');
      INSERT INTO "PurchaseOrderItem" VALUES ('later','p');`);
    const result = await loadReceiptStockBaselines(["p"], at, "current", { $queryRaw: query } as unknown as Prisma.TransactionClient);
    expect(result.get("p")).toMatchObject({ error: expect.stringContaining("kasnija proknjižena prijemnica") });
  });
  it("respects Belgrade's winter offset", async () => {
    await sql.exec(`UPDATE "Product" SET stock=-101;
      INSERT INTO "StockMovement" VALUES ('before','p',-1,'ADJUSTMENT','2025-11-20 22:59:59',NULL),
        ('after','p',-2,'ADJUSTMENT','2025-11-20 23:00:00',NULL);`);
    expect((await query(receiptStockBaselineQuery(["p"], new Date("2025-11-21"), "current")))[0]).toMatchObject({ stock: -1 });
  });
  it("returns an empty map without querying when the receipt has no linked products", async () => {
    const read = vi.fn();
    expect(await loadReceiptStockBaselines([], at, "current", { $queryRaw: read } as unknown as Prisma.TransactionClient)).toEqual(new Map());
    expect(read).not.toHaveBeenCalled();
  });
});
