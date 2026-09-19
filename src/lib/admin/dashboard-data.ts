import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveReportPeriod, type ReportPeriod } from "./report-period";

type WarehouseStockRow = {
  id: string;
  code: string;
  name: string;
  total_qty: number;
  sku_count: number;
  stock_value: number;
  total_volume: number;
  occupied_pallet_places: number;
  missing_pallet_sku_count: number;
};

type IncomingSummary = {
  order_count: number;
  remaining_qty: number;
  value_rsd: number;
  total_volume: number;
};

type VisitSummary = {
  active_now: number;
  today: number;
  daily_average_30d: number;
};

type ConversionSummary = {
  visitors: number;
  purchasers: number;
  purchase_value: number;
  cart_buyers: number;
  converted_cart_buyers: number;
};

type FiscalTurnoverSummary = {
  today_net: number;
  period_net: number;
};

type LowStockRow = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  incoming_stock: number;
};

type DashboardTopProduct = {
  sku: string;
  name: string;
  qty: number;
};


export type DashboardDataInput = {
  now: Date;
  warehouseId: string;
  todayPeriod: ReportPeriod;
  ordersPeriod: ReportPeriod;
  fiscalPeriod: ReportPeriod;
  reclamationsPeriod: ReportPeriod;
  topProductsPeriod: ReportPeriod;
  analyticsPeriod: ReportPeriod;
};

type OrderSummary = {
  today_count: number;
  today_total: number;
  today_shipping: number;
  period_count: number;
  period_total: number;
  period_shipping: number;
};

export type DashboardData = {
  orderSummary: OrderSummary;
  reclamationCount: number;
  fiscalRows: FiscalTurnoverSummary[];
  topProducts: DashboardTopProduct[];
  warehouseStockRows: WarehouseStockRow[];
  incomingRows: IncomingSummary[];
  visitRows: VisitSummary[];
  conversionRows: ConversionSummary[];
  lowStock: LowStockRow[];
};

// Each section is a single read-only statement. Operational cards share one
// fresh snapshot; analytics can stream separately without holding them back.
export function buildDashboardDataQuery(input: DashboardDataInput, section: "all" | "operations" | "analytics" = "all") {
  const { now, warehouseId, todayPeriod, ordersPeriod, fiscalPeriod,
    reclamationsPeriod, topProductsPeriod, analyticsPeriod } = input;
  const visitsPeriod = resolveReportPeriod({ range: "30d" }, now);
  const orderWarehouseSql = warehouseId
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id AND oi."warehouseId" = ${warehouseId})`
    : Prisma.empty;
  const reclamationWarehouseSql = warehouseId ? Prisma.sql`AND r."warehouseId" = ${warehouseId}` : Prisma.empty;
  const fiscalWarehouseSql = warehouseId
    ? Prisma.sql`AND f."warehouseId" = ${warehouseId}`
    : Prisma.empty;
  const orderItemWarehouseSql = warehouseId
    ? Prisma.sql`AND oi."warehouseId" = ${warehouseId}`
    : Prisma.empty;
  const stockWarehouseSql = warehouseId
    ? Prisma.sql`AND w.id = ${warehouseId}`
    : Prisma.empty;
  const purchaseWarehouseSql = warehouseId
    ? Prisma.sql`AND po."receivingWarehouseId" = ${warehouseId}`
    : Prisma.empty;

  const operations = Prisma.sql`
    (SELECT row_to_json(result) FROM (
      SELECT
        COUNT(*) FILTER (WHERE o."createdAt" >= ${todayPeriod.start} AND o."createdAt" < ${todayPeriod.endExclusive})::int AS today_count,
        COALESCE(SUM(o.total) FILTER (WHERE o."createdAt" >= ${todayPeriod.start} AND o."createdAt" < ${todayPeriod.endExclusive}), 0)::double precision AS today_total,
        COALESCE(SUM(o.shipping) FILTER (WHERE o."createdAt" >= ${todayPeriod.start} AND o."createdAt" < ${todayPeriod.endExclusive}), 0)::double precision AS today_shipping,
        COUNT(*) FILTER (WHERE o."createdAt" >= ${ordersPeriod.start} AND o."createdAt" < ${ordersPeriod.endExclusive})::int AS period_count,
        COALESCE(SUM(o.total) FILTER (WHERE o."createdAt" >= ${ordersPeriod.start} AND o."createdAt" < ${ordersPeriod.endExclusive}), 0)::double precision AS period_total,
        COALESCE(SUM(o.shipping) FILTER (WHERE o."createdAt" >= ${ordersPeriod.start} AND o."createdAt" < ${ordersPeriod.endExclusive}), 0)::double precision AS period_shipping
      FROM "Order" o
      WHERE ((o."createdAt" >= ${todayPeriod.start} AND o."createdAt" < ${todayPeriod.endExclusive})
        OR (o."createdAt" >= ${ordersPeriod.start} AND o."createdAt" < ${ordersPeriod.endExclusive}))
        ${orderWarehouseSql}
    ) result) AS "orderSummary",
    (SELECT COUNT(*)::int FROM "Reclamation" r
      WHERE r."createdAt" >= ${reclamationsPeriod.start} AND r."createdAt" < ${reclamationsPeriod.endExclusive}
      ${reclamationWarehouseSql}) AS "reclamationCount",
    (SELECT COALESCE(json_agg(result), '[]'::json) FROM (
      SELECT
        COALESCE(SUM(
          CASE
            WHEN f."issuedAt" >= ${todayPeriod.start}
              AND f."issuedAt" < ${todayPeriod.endExclusive}
            THEN CASE WHEN f.kind = 'SALE' THEN f."totalGross" ELSE -f."totalGross" END
            ELSE 0
          END
        ), 0)::double precision AS today_net,
        COALESCE(SUM(
          CASE
            WHEN f."issuedAt" >= ${fiscalPeriod.start}
              AND f."issuedAt" < ${fiscalPeriod.endExclusive}
            THEN CASE WHEN f.kind = 'SALE' THEN f."totalGross" ELSE -f."totalGross" END
            ELSE 0
          END
        ), 0)::double precision AS period_net
      FROM "FiscalDocument" f
      WHERE f.status = 'ISSUED'
        AND f.kind IN ('SALE', 'REFUND')
        AND (
          (f."issuedAt" >= ${todayPeriod.start} AND f."issuedAt" < ${todayPeriod.endExclusive})
          OR
          (f."issuedAt" >= ${fiscalPeriod.start} AND f."issuedAt" < ${fiscalPeriod.endExclusive})
        )
        ${fiscalWarehouseSql}
    ) result) AS "fiscalRows",
    (SELECT COALESCE(json_agg(result), '[]'::json) FROM (
      SELECT
        oi.sku,
        oi.name,
        COALESCE(SUM(oi.qty), 0)::int AS qty
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status <> 'OTKAZANO'
        AND o."createdAt" >= ${topProductsPeriod.start}
        AND o."createdAt" < ${topProductsPeriod.endExclusive}
        ${orderItemWarehouseSql}
      GROUP BY oi.sku, oi.name
      ORDER BY qty DESC, oi.sku ASC
      LIMIT 10
    ) result) AS "topProducts",
    (SELECT COALESCE(json_agg(result), '[]'::json) FROM (
      SELECT
        w.id,
        w.code,
        w.name,
        COALESCE(SUM(GREATEST(ws.qty, 0)), 0)::int AS total_qty,
        COUNT(DISTINCT CASE WHEN ws.qty > 0 THEN ws."productId" END)::int AS sku_count,
        COALESCE(SUM(GREATEST(ws.qty, 0) * COALESCE(p.cogs, 0)), 0)::double precision AS stock_value,
        COALESCE(SUM(
          GREATEST(ws.qty, 0)
          * CASE
              WHEN p."containerQty" > 0
                THEN 69.0 / p."containerQty"
              WHEN p."packQty" > 0
                AND p."packWidthCm" > 0
                AND p."packDepthCm" > 0
                AND p."packHeightCm" > 0
                THEN p."packWidthCm"
                  * p."packDepthCm"
                  * p."packHeightCm"
                  / 1000000.0
                  / p."packQty"
              ELSE 0
            END
        ), 0)::double precision AS total_volume,
        COALESCE(SUM(
          CASE
            WHEN ws.qty > 0 AND p."palletQty" > 0
            THEN CEIL(ws.qty::numeric / p."palletQty")
            ELSE 0
          END
        ), 0)::int AS occupied_pallet_places,
        COUNT(DISTINCT CASE
          WHEN ws.qty > 0 AND (p."palletQty" IS NULL OR p."palletQty" <= 0)
          THEN ws."productId"
        END)::int AS missing_pallet_sku_count
      FROM "Warehouse" w
      LEFT JOIN "WarehouseStock" ws ON ws."warehouseId" = w.id
      LEFT JOIN "Product" p ON p.id = ws."productId"
      WHERE w.active = true
      GROUP BY w.id, w.code, w.name
      ORDER BY w.name ASC
    ) result) AS "warehouseStockRows",
    (SELECT COALESCE(json_agg(result), '[]'::json) FROM (
      SELECT
        COUNT(DISTINCT po.id)::int AS order_count,
        COALESCE(SUM(GREATEST(poi.qty - poi."receivedQty", 0)), 0)::int AS remaining_qty,
        COALESCE(SUM(
          GREATEST(poi.qty - poi."receivedQty", 0)
          * poi."purchasePrice" * po."exchangeRate"
        ), 0)::double precision AS value_rsd,
        COALESCE(SUM(
          CASE WHEN poi.qty > 0 THEN COALESCE(poi."totalVolume", 0)
            * GREATEST(poi.qty - poi."receivedQty", 0)::numeric / poi.qty
          ELSE 0 END
        ), 0)::double precision AS total_volume
      FROM "PurchaseOrder" po
      LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      WHERE po.status IN ('DRAFT', 'SENT', 'CONFIRMED') ${purchaseWarehouseSql}
    ) result) AS "incomingRows",
    (SELECT COALESCE(json_agg(result), '[]'::json) FROM (
      SELECT
        p.id,
        p.sku,
        p.name,
        COALESCE(SUM(CASE WHEN w.id IS NOT NULL THEN ws.qty ELSE 0 END), 0)::int AS qty,
        p."incomingStock"::int AS incoming_stock
      FROM "Product" p
      LEFT JOIN "WarehouseStock" ws ON ws."productId" = p.id
      LEFT JOIN "Warehouse" w
        ON w.id = ws."warehouseId" AND w.active = true ${stockWarehouseSql}
      WHERE p."isActive" = true
      GROUP BY p.id, p.sku, p.name, p."incomingStock"
      HAVING COALESCE(SUM(CASE WHEN w.id IS NOT NULL THEN ws.qty ELSE 0 END), 0) <= 2
      ORDER BY qty ASC, p.name ASC
      LIMIT 8
    ) result) AS "lowStock"
  `;
  const analytics = Prisma.sql`
    (SELECT COALESCE(json_agg(result), '[]'::json) FROM (
      WITH daily AS (
        SELECT
          (a."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade')::date AS day,
          COUNT(DISTINCT COALESCE(a."sessionId", a."anonymousId"))::double precision AS visits
        FROM "AnalyticsEvent" a
        WHERE a.type = 'PAGE_VIEW'
          AND a."occurredAt" >= ${visitsPeriod.start}
          AND a."occurredAt" < ${visitsPeriod.endExclusive}
        GROUP BY 1
      )
      SELECT
        (SELECT COUNT(DISTINCT COALESCE("sessionId", "anonymousId"))
          FROM "AnalyticsEvent"
          WHERE type = 'PAGE_VIEW'
            AND "occurredAt" >= ${new Date(now.getTime() - 300_000)})::int AS active_now,
        COALESCE((SELECT visits FROM daily WHERE day = ${todayPeriod.fromInput}::date), 0)::int AS today,
        (COALESCE((SELECT SUM(visits) FROM daily), 0) / 30.0)::double precision AS daily_average_30d
    ) result) AS "visitRows",
    (SELECT COALESCE(json_agg(result), '[]'::json) FROM (
      WITH visitors AS (
        SELECT DISTINCT a."anonymousId"
        FROM "AnalyticsEvent" a
        WHERE a.type = 'PAGE_VIEW'
          AND a."occurredAt" >= ${analyticsPeriod.start}
          AND a."occurredAt" < ${analyticsPeriod.endExclusive}
      ), attributed AS (
        SELECT DISTINCT ON (c."orderId")
          c."orderId",
          c."anonymousId",
          COALESCE(c.value, 0)::double precision AS value
        FROM "AnalyticsEvent" c
        WHERE c.type = 'CHECKOUT_COMPLETED'
          AND c."orderId" IS NOT NULL
          AND c."occurredAt" >= ${analyticsPeriod.start}
          AND c."occurredAt" < ${analyticsPeriod.endExclusive}
          AND EXISTS (
            SELECT 1
            FROM "AnalyticsEvent" v
            WHERE v.type = 'PAGE_VIEW'
              AND v."anonymousId" = c."anonymousId"
              AND v."occurredAt" <= c."occurredAt"
              AND v."occurredAt" >= c."occurredAt" - interval '30 days'
          )
        ORDER BY c."orderId", c."occurredAt" ASC
      ), cart_buyers AS (
        SELECT
          a."anonymousId",
          MIN(a."occurredAt") AS first_cart_at
        FROM "AnalyticsEvent" a
        WHERE a.type = 'ADD_TO_CART'
          AND a."occurredAt" >= ${analyticsPeriod.start}
          AND a."occurredAt" < ${analyticsPeriod.endExclusive}
        GROUP BY a."anonymousId"
      ), converted_cart_buyers AS (
        SELECT DISTINCT carts."anonymousId"
        FROM cart_buyers carts
        JOIN "AnalyticsEvent" c
          ON c."anonymousId" = carts."anonymousId"
          AND c.type = 'CHECKOUT_COMPLETED'
          AND c."occurredAt" >= carts.first_cart_at
          AND c."occurredAt" <= carts.first_cart_at + interval '30 days'
      )
      SELECT
        (SELECT COUNT(*) FROM visitors)::int AS visitors,
        (SELECT COUNT(DISTINCT "anonymousId") FROM attributed)::int AS purchasers,
        COALESCE((SELECT SUM(value) FROM attributed), 0)::double precision AS purchase_value,
        (SELECT COUNT(*) FROM cart_buyers)::int AS cart_buyers,
        (SELECT COUNT(*) FROM converted_cart_buyers)::int AS converted_cart_buyers
    ) result) AS "conversionRows"
  `;
  return Prisma.sql`SELECT ${section === "operations" ? operations : section === "analytics" ? analytics : Prisma.sql`${operations}, ${analytics}`}`;
}

export async function getDashboardData(input: DashboardDataInput): Promise<DashboardData> {
  const [data] = await db.$queryRaw<DashboardData[]>(buildDashboardDataQuery(input));
  if (!data) throw new Error("Podaci kontrolne table nisu učitani.");
  return data;
}

export type DashboardOperations = Omit<DashboardData, "visitRows" | "conversionRows">;
export type DashboardAnalytics = Pick<DashboardData, "visitRows" | "conversionRows">;

export async function getDashboardOperations(input: DashboardDataInput): Promise<DashboardOperations> {
  const [data] = await db.$queryRaw<DashboardOperations[]>(buildDashboardDataQuery(input, "operations"));
  if (!data) throw new Error("Poslovni podaci kontrolne table nisu učitani.");
  return data;
}

export async function getDashboardAnalyticsData(input: DashboardDataInput): Promise<DashboardAnalytics> {
  const [data] = await db.$queryRaw<DashboardAnalytics[]>(buildDashboardDataQuery(input, "analytics"));
  if (!data) throw new Error("Analitika kontrolne table nije učitana.");
  return data;
}
