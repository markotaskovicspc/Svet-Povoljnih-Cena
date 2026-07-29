import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import {
  REPORT_PERIOD_PRESETS,
  resolveReportPeriod,
} from "@/lib/admin/report-period";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Izveštaji",
  robots: { index: false, follow: false },
};

type StockSummaryRow = {
  total_qty: number;
  sku_count: number;
  stock_value: number;
  total_volume: number;
};

type WarehouseStockRow = StockSummaryRow & {
  id: string;
  code: string;
  name: string;
};

type IncomingSummaryRow = {
  order_count: number;
  remaining_qty: number;
  value_rsd: number;
  total_volume: number;
};

type IncomingBreakdownRow = IncomingSummaryRow & {
  supplier: string;
  status: string;
  article_status: string;
};

type SalesKpisRow = {
  merchandise_gross: number;
  merchandise_qty: number;
  distinct_orders: number;
  repeat_customers: number;
  identified_customers: number;
  average_delivery_days: number;
  daily_max: number;
  daily_max_date: string | null;
  monthly_max: number;
  monthly_max_date: string | null;
};

type InventoryTurnoverRow = {
  product_id: string;
  sku: string;
  name: string;
  supplier: string;
  article_status: string;
  warehouse_id: string;
  warehouse: string;
  average_qty: number;
  average_value: number;
  cogs: number;
  turnover: number;
};

type TopItemRow = {
  sku: string;
  short_name: string;
  qty: number;
  revenue: number;
};

type TopCategoryRow = {
  category_name: string | null;
  qty: number;
  revenue: number;
};

const RECLAMATION_STATUS_LABELS: Record<string, string> = {
  PRIMLJENO: "Primljeno",
  U_OBRADI: "U obradi",
  RESENO: "Rešeno",
  ODBIJENO: "Odbijeno",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS", "ADS"]);
  const period = resolveReportPeriod(await searchParams);
  const periodFilter = { gte: period.start, lt: period.endExclusive };
  const fiscalSaleWhere: Prisma.FiscalDocumentWhereInput = {
    kind: "SALE",
    status: "ISSUED",
    issuedAt: periodFilter,
  };

  const [
    fiscalSales,
    fiscalRefunds,
    fiscalOrderGroups,
    topItems,
    topCategories,
    stockSummaryRows,
    warehouseStockRows,
    incomingSummaryRows,
    incomingBreakdown,
    reclamations,
    salesKpiRows,
    inventoryTurnover,
  ] = await Promise.all([
    db.fiscalDocument.aggregate({
      where: fiscalSaleWhere,
      _count: { id: true },
      _sum: { totalGross: true },
    }),
    db.fiscalDocument.aggregate({
      where: {
        kind: "REFUND",
        status: "ISSUED",
        issuedAt: periodFilter,
      },
      _count: { id: true },
      _sum: { totalGross: true },
    }),
    db.fiscalDocument.groupBy({
      by: ["orderId"],
      where: fiscalSaleWhere,
    }),
    db.$queryRaw<TopItemRow[]>(Prisma.sql`
      SELECT
        l.sku,
        l."shortName" AS short_name,
        COALESCE(SUM(l.qty), 0)::int AS qty,
        COALESCE(SUM(GREATEST(l."totalGross" - l."serviceGross", 0)), 0)::double precision AS revenue
      FROM "FiscalDocumentLine" l
      JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
      WHERE f.kind = 'SALE'
        AND f.status = 'ISSUED'
        AND f."issuedAt" >= ${period.start}
        AND f."issuedAt" < ${period.endExclusive}
        AND l."productId" IS NOT NULL
      GROUP BY l.sku, l."shortName"
      ORDER BY qty DESC, revenue DESC, l.sku ASC
      LIMIT 10
    `),
    db.$queryRaw<TopCategoryRow[]>(Prisma.sql`
      SELECT
        l."categoryName" AS category_name,
        COALESCE(SUM(l.qty), 0)::int AS qty,
        COALESCE(SUM(GREATEST(l."totalGross" - l."serviceGross", 0)), 0)::double precision AS revenue
      FROM "FiscalDocumentLine" l
      JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
      WHERE f.kind = 'SALE'
        AND f.status = 'ISSUED'
        AND f."issuedAt" >= ${period.start}
        AND f."issuedAt" < ${period.endExclusive}
        AND l."productId" IS NOT NULL
      GROUP BY l."categoryName"
      ORDER BY revenue DESC, category_name ASC NULLS LAST
      LIMIT 10
    `),
    db.$queryRaw<StockSummaryRow[]>(Prisma.sql`
      SELECT
        COALESCE(SUM(GREATEST(ws.qty, 0)), 0)::int AS total_qty,
        COUNT(DISTINCT CASE WHEN ws.qty > 0 THEN ws."productId" END)::int AS sku_count,
        COALESCE(SUM(GREATEST(ws.qty, 0) * COALESCE(p.cogs, 0)), 0)::double precision AS stock_value,
        COALESCE(SUM(
          GREATEST(ws.qty, 0)
          * COALESCE(p."widthCm" * p."depthCm" * p."heightCm" / 1000000, 0)
        ), 0)::double precision AS total_volume
      FROM "WarehouseStock" ws
      JOIN "Warehouse" w ON w.id = ws."warehouseId" AND w.active = true
      JOIN "Product" p ON p.id = ws."productId"
    `),
    db.$queryRaw<WarehouseStockRow[]>(Prisma.sql`
      SELECT
        w.id,
        w.code,
        w.name,
        COALESCE(SUM(GREATEST(ws.qty, 0)), 0)::int AS total_qty,
        COUNT(DISTINCT CASE WHEN ws.qty > 0 THEN ws."productId" END)::int AS sku_count,
        COALESCE(SUM(GREATEST(ws.qty, 0) * COALESCE(p.cogs, 0)), 0)::double precision AS stock_value,
        COALESCE(SUM(
          GREATEST(ws.qty, 0)
          * COALESCE(p."widthCm" * p."depthCm" * p."heightCm" / 1000000, 0)
        ), 0)::double precision AS total_volume
      FROM "Warehouse" w
      LEFT JOIN "WarehouseStock" ws ON ws."warehouseId" = w.id
      LEFT JOIN "Product" p ON p.id = ws."productId"
      WHERE w.active = true
      GROUP BY w.id, w.code, w.name
      ORDER BY total_qty DESC, w.name ASC
    `),
    db.$queryRaw<IncomingSummaryRow[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT po.id)::int AS order_count,
        COALESCE(SUM(GREATEST(poi.qty - poi."receivedQty", 0)), 0)::int AS remaining_qty,
        COALESCE(SUM(
          GREATEST(poi.qty - poi."receivedQty", 0)
          * poi."purchasePrice"
          * po."exchangeRate"
        ), 0)::double precision AS value_rsd,
        COALESCE(SUM(
          CASE WHEN poi.qty > 0 THEN
            COALESCE(poi."totalVolume", 0)
            * GREATEST(poi.qty - poi."receivedQty", 0)::numeric
            / poi.qty
          ELSE 0 END
        ), 0)::double precision AS total_volume
      FROM "PurchaseOrder" po
      LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      WHERE po.status IN ('SENT', 'CONFIRMED')
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") >= ${period.start}
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") < ${period.endExclusive}
    `),
    db.$queryRaw<IncomingBreakdownRow[]>(Prisma.sql`
      SELECT
        COALESCE(s.name, 'Bez dobavljača') AS supplier,
        po.status::text AS status,
        COALESCE(p."articleStatus"::text, 'BEZ_ARTIKLA') AS article_status,
        COUNT(DISTINCT po.id)::int AS order_count,
        COALESCE(SUM(GREATEST(poi.qty - poi."receivedQty", 0)), 0)::int AS remaining_qty,
        COALESCE(SUM(
          GREATEST(poi.qty - poi."receivedQty", 0)
          * poi."purchasePrice"
          * po."exchangeRate"
        ), 0)::double precision AS value_rsd,
        COALESCE(SUM(
          CASE WHEN poi.qty > 0 THEN
            COALESCE(poi."totalVolume", 0)
            * GREATEST(poi.qty - poi."receivedQty", 0)::numeric
            / poi.qty
          ELSE 0 END
        ), 0)::double precision AS total_volume
      FROM "PurchaseOrder" po
      LEFT JOIN "Supplier" s ON s.id = po."supplierId"
      LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      LEFT JOIN "Product" p ON p.id = poi."productId"
      WHERE po.status IN ('SENT', 'CONFIRMED')
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") >= ${period.start}
        AND COALESCE(po."deliveryDate", po."orderDate", po."createdAt") < ${period.endExclusive}
      GROUP BY s.name, po.status, p."articleStatus"
      ORDER BY value_rsd DESC, supplier ASC, article_status ASC
    `),
    db.reclamation.findMany({
      where: { createdAt: periodFilter },
      select: {
        orderId: true,
        sku: true,
        status: true,
        decision: true,
        createdAt: true,
        resolvedAt: true,
        respondedAt: true,
        quantity: true,
        request: true,
        resolution: true,
      },
    }),
    db.$queryRaw<SalesKpisRow[]>(Prisma.sql`
      WITH sale_lines AS (
        SELECT
          f."orderId",
          f."issuedAt",
          GREATEST(l."totalGross" - l."serviceGross", 0)::numeric AS merchandise_gross,
          CASE WHEN l."productId" IS NOT NULL THEN l.qty ELSE 0 END AS merchandise_qty
        FROM "FiscalDocument" f
        JOIN "FiscalDocumentLine" l ON l."fiscalDocumentId" = f.id
        WHERE f.kind = 'SALE'
          AND f.status = 'ISSUED'
          AND f."issuedAt" >= ${period.start}
          AND f."issuedAt" < ${period.endExclusive}
      ), order_sales AS (
        SELECT
          sl."orderId",
          MIN(sl."issuedAt") AS issued_at,
          SUM(sl.merchandise_gross)::double precision AS gross,
          SUM(sl.merchandise_qty)::int AS qty
        FROM sale_lines sl
        GROUP BY sl."orderId"
      ), customer_orders AS (
        SELECT
          os."orderId",
          COALESCE(
            o."userId",
            o."customerId",
            NULLIF(LOWER(BTRIM(COALESCE(o."guestEmail", ''))), '')
          ) AS identity
        FROM order_sales os
        JOIN "Order" o ON o.id = os."orderId"
      ), repeat_summary AS (
        SELECT
          COUNT(*) FILTER (WHERE purchases > 1)::int AS repeat_customers,
          COUNT(*)::int AS identified_customers
        FROM (
          SELECT identity, COUNT(DISTINCT "orderId") AS purchases
          FROM customer_orders
          WHERE identity IS NOT NULL
          GROUP BY identity
        ) grouped
      ), delivered AS (
        SELECT DISTINCT ON (o.id)
          o.id,
          EXTRACT(EPOCH FROM (s."deliveredAt" - o."createdAt")) / 86400.0 AS days
        FROM order_sales os
        JOIN "Order" o ON o.id = os."orderId"
        JOIN "Shipment" s ON s."orderId" = o.id
        WHERE s.purpose = 'ORDER_DELIVERY'
          AND s."deliveredAt" IS NOT NULL
        ORDER BY o.id, s."deliveredAt" ASC
      ), daily AS (
        SELECT
          (issued_at AT TIME ZONE 'Europe/Belgrade')::date AS bucket,
          SUM(gross)::double precision AS gross
        FROM order_sales
        GROUP BY bucket
      ), monthly AS (
        SELECT
          date_trunc('month', issued_at AT TIME ZONE 'Europe/Belgrade')::date AS bucket,
          SUM(gross)::double precision AS gross
        FROM order_sales
        GROUP BY bucket
      )
      SELECT
        COALESCE((SELECT SUM(gross) FROM order_sales), 0)::double precision AS merchandise_gross,
        COALESCE((SELECT SUM(qty) FROM order_sales), 0)::int AS merchandise_qty,
        (SELECT COUNT(*) FROM order_sales)::int AS distinct_orders,
        COALESCE((SELECT repeat_customers FROM repeat_summary), 0)::int AS repeat_customers,
        COALESCE((SELECT identified_customers FROM repeat_summary), 0)::int AS identified_customers,
        COALESCE((SELECT AVG(days) FROM delivered), 0)::double precision AS average_delivery_days,
        COALESCE((SELECT gross FROM daily ORDER BY gross DESC, bucket ASC LIMIT 1), 0)::double precision AS daily_max,
        (SELECT bucket::text FROM daily ORDER BY gross DESC, bucket ASC LIMIT 1) AS daily_max_date,
        COALESCE((SELECT gross FROM monthly ORDER BY gross DESC, bucket ASC LIMIT 1), 0)::double precision AS monthly_max,
        (SELECT bucket::text FROM monthly ORDER BY gross DESC, bucket ASC LIMIT 1) AS monthly_max_date
    `),
    db.$queryRaw<InventoryTurnoverRow[]>(Prisma.sql`
      WITH local_days AS (
        SELECT day::date AS day
        FROM generate_series(
          (${period.start}::timestamptz AT TIME ZONE 'Europe/Belgrade')::date,
          ((${period.endExclusive}::timestamptz - interval '1 second') AT TIME ZONE 'Europe/Belgrade')::date,
          interval '1 day'
        ) day
      ), day_ends AS (
        SELECT
          day,
          ((day + 1)::timestamp AT TIME ZONE 'Europe/Belgrade') AS day_end
        FROM local_days
      ), combinations AS (
        SELECT ws."warehouseId", ws."productId"
        FROM "WarehouseStock" ws
        UNION
        SELECT sm."warehouseId", sm."productId"
        FROM "StockMovement" sm
        WHERE sm."productId" IS NOT NULL
          AND sm."createdAt" < ${period.endExclusive}
        UNION
        SELECT f."warehouseId", l."productId"
        FROM "FiscalDocument" f
        JOIN "FiscalDocumentLine" l ON l."fiscalDocumentId" = f.id
        WHERE f."warehouseId" IS NOT NULL
          AND l."productId" IS NOT NULL
          AND f."issuedAt" >= ${period.start}
          AND f."issuedAt" < ${period.endExclusive}
      ), daily_closing AS (
        SELECT
          c."warehouseId",
          c."productId",
          d.day,
          GREATEST(
            COALESCE(ws.qty, 0) - COALESCE((
              SELECT SUM(sm.qty)
              FROM "StockMovement" sm
              WHERE sm."warehouseId" = c."warehouseId"
                AND sm."productId" = c."productId"
                AND sm."createdAt" >= d.day_end
            ), 0),
            0
          )::double precision AS closing_qty
        FROM combinations c
        CROSS JOIN day_ends d
        LEFT JOIN "WarehouseStock" ws
          ON ws."warehouseId" = c."warehouseId"
          AND ws."productId" = c."productId"
      ), average_stock AS (
        SELECT
          "warehouseId",
          "productId",
          AVG(closing_qty)::double precision AS average_qty
        FROM daily_closing
        GROUP BY "warehouseId", "productId"
      ), period_cogs AS (
        SELECT
          f."warehouseId",
          l."productId",
          SUM(
            CASE WHEN f.kind = 'REFUND' THEN -1 ELSE 1 END
            * l.qty * COALESCE(l."unitCogs", p.cogs, 0)
          )::double precision AS cogs
        FROM "FiscalDocument" f
        JOIN "FiscalDocumentLine" l ON l."fiscalDocumentId" = f.id
        LEFT JOIN "Product" p ON p.id = l."productId"
        WHERE f.status = 'ISSUED'
          AND f."issuedAt" >= ${period.start}
          AND f."issuedAt" < ${period.endExclusive}
          AND f."warehouseId" IS NOT NULL
          AND l."productId" IS NOT NULL
        GROUP BY f."warehouseId", l."productId"
      )
      SELECT
        p.id AS product_id,
        p.sku,
        p.name,
        COALESCE(s.name, 'Bez dobavljača') AS supplier,
        p."articleStatus"::text AS article_status,
        w.id AS warehouse_id,
        w.name AS warehouse,
        a.average_qty,
        (a.average_qty * COALESCE(p.cogs, 0))::double precision AS average_value,
        COALESCE(c.cogs, 0)::double precision AS cogs,
        CASE WHEN a.average_qty * COALESCE(p.cogs, 0) > 0
          THEN COALESCE(c.cogs, 0) / (a.average_qty * COALESCE(p.cogs, 0))
          ELSE 0 END::double precision AS turnover
      FROM average_stock a
      JOIN "Product" p ON p.id = a."productId"
      JOIN "Warehouse" w ON w.id = a."warehouseId"
      LEFT JOIN "Supplier" s ON s.id = p."supplierId"
      LEFT JOIN period_cogs c
        ON c."warehouseId" = a."warehouseId"
        AND c."productId" = a."productId"
      ORDER BY turnover DESC, p.sku ASC, w.name ASC
    `),
  ]);

  const stockSummary = stockSummaryRows[0] ?? {
    total_qty: 0,
    sku_count: 0,
    stock_value: 0,
    total_volume: 0,
  };
  const incomingSummary = incomingSummaryRows[0] ?? {
    order_count: 0,
    remaining_qty: 0,
    value_rsd: 0,
    total_volume: 0,
  };
  const salesKpis = salesKpiRows[0] ?? {
    merchandise_gross: 0,
    merchandise_qty: 0,
    distinct_orders: 0,
    repeat_customers: 0,
    identified_customers: 0,
    average_delivery_days: 0,
    daily_max: 0,
    daily_max_date: null,
    monthly_max: 0,
    monthly_max_date: null,
  };
  const averageMerchandisePrice = salesKpis.merchandise_qty
    ? salesKpis.merchandise_gross / salesKpis.merchandise_qty
    : 0;
  const averageBasket = salesKpis.distinct_orders
    ? salesKpis.merchandise_gross / salesKpis.distinct_orders
    : 0;
  const itemsPerBasket = salesKpis.distinct_orders
    ? salesKpis.merchandise_qty / salesKpis.distinct_orders
    : 0;
  const repeatCustomerShare = salesKpis.identified_customers
    ? (salesKpis.repeat_customers / salesKpis.identified_customers) * 100
    : 0;
  const inventorySummary = inventoryTurnover.reduce(
    (summary, row) => ({
      averageValue: summary.averageValue + row.average_value,
      averageQty: summary.averageQty + row.average_qty,
      cogs: summary.cogs + row.cogs,
    }),
    { averageValue: 0, averageQty: 0, cogs: 0 },
  );
  const totalTurnover = inventorySummary.averageValue
    ? inventorySummary.cogs / inventorySummary.averageValue
    : 0;
  const turnoverByProduct = aggregateTurnover(
    inventoryTurnover,
    (row) => row.product_id,
    (row) => `${row.sku} · ${row.name}`,
  );
  const turnoverBySupplier = aggregateTurnover(
    inventoryTurnover,
    (row) => row.supplier,
    (row) => row.supplier,
  );
  const turnoverByWarehouse = aggregateTurnover(
    inventoryTurnover,
    (row) => row.warehouse_id,
    (row) => row.warehouse,
  );
  const turnoverByStatus = aggregateTurnover(
    inventoryTurnover,
    (row) => row.article_status,
    (row) => row.article_status,
  );
  const saleGross = num(fiscalSales._sum.totalGross ?? 0);
  const refundGross = num(fiscalRefunds._sum.totalGross ?? 0);
  const netFiscalized = saleGross - refundGross;
  const uniqueReclamationOrders = new Set(reclamations.map((item) => item.orderId)).size;
  const reclamationShare = fiscalOrderGroups.length
    ? (uniqueReclamationOrders / fiscalOrderGroups.length) * 100
    : 0;
  const openReclamations = reclamations.filter(
    (item) => item.status === "PRIMLJENO" || item.status === "U_OBRADI",
  ).length;
  const acceptedReclamations = reclamations.filter(
    (item) => item.decision === "PRIHVACENA",
  ).length;
  const resolvedDurations = reclamations.flatMap((item) =>
    item.resolvedAt
      ? [(item.resolvedAt.getTime() - item.createdAt.getTime()) / 86_400_000]
      : [],
  );
  const averageResolutionDays = resolvedDurations.length
    ? resolvedDurations.reduce((sum, days) => sum + days, 0) / resolvedDurations.length
    : 0;
  const responseDurations = reclamations.flatMap((item) =>
    item.respondedAt
      ? [(item.respondedAt.getTime() - item.createdAt.getTime()) / 86_400_000]
      : [],
  );
  const averageResponseDays = responseDurations.length
    ? responseDurations.reduce((sum, days) => sum + days, 0) / responseDurations.length
    : 0;
  const reclamationQuantity = reclamations.reduce((sum, item) => sum + item.quantity, 0);
  const rejectedReclamations = reclamations.filter(
    (item) => item.decision === "ODBIJENA",
  ).length;
  const reclamationsByStatus = Object.entries(
    reclamations.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([, left], [, right]) => right - left);
  const topReclamationSkus = Object.entries(
    reclamations.reduce<Record<string, number>>((counts, item) => {
      counts[item.sku] = (counts[item.sku] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .sort(([, left], [, right]) => right - left)
    .slice(0, 10);
  const reclamationsByRequest = Object.entries(
    reclamations.reduce<Record<string, number>>((counts, item) => {
      const key = item.request ?? "NIJE_ODABRAN";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([, left], [, right]) => right - left);
  const reclamationsByResolution = Object.entries(
    reclamations.reduce<Record<string, number>>((counts, item) => {
      const key = item.resolution ?? "NIJE_RESENO";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([, left], [, right]) => right - left);

  return (
    <>
      <PageHeader
        title="Izveštaji"
        description={period.label}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Izveštaji" }]}
      />
      <div className="space-y-10 px-8 py-6">
        <Card>
          <CardTitle description="Izaberite brzi period ili unesite tačan raspon datuma.">
            Period izveštaja
          </CardTitle>
          <div className="space-y-4">
            <nav aria-label="Brzi izbor perioda" className="flex flex-wrap gap-2 text-xs">
              {REPORT_PERIOD_PRESETS.map((preset) => (
                <Link
                  key={preset.key}
                  href={`/admin/izvestaji?range=${preset.key}`}
                  aria-current={period.preset === preset.key ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 transition ${
                    period.preset === preset.key
                      ? "bg-walnut text-white"
                      : "bg-muted-bg text-ink-700 hover:bg-muted-bg/70"
                  }`}
                >
                  {preset.label}
                </Link>
              ))}
            </nav>

            <form method="get" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="range" value="custom" />
              <div>
                <label
                  htmlFor="report-from"
                  className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500"
                >
                  Od
                </label>
                <Input
                  id="report-from"
                  name="from"
                  type="date"
                  required
                  defaultValue={period.fromInput}
                  className="h-9"
                />
              </div>
              <div>
                <label
                  htmlFor="report-to"
                  className="text-xs font-medium uppercase tracking-[0.12em] text-ink-500"
                >
                  Do
                </label>
                <Input
                  id="report-to"
                  name="to"
                  type="date"
                  required
                  defaultValue={period.toInput}
                  className="h-9"
                />
              </div>
              <button
                type="submit"
                className="h-9 rounded-lg bg-walnut px-4 text-sm font-medium text-white transition hover:bg-walnut/90"
              >
                Prikaži period
              </button>
            </form>
          </div>
        </Card>

        <nav
          aria-label="Delovi izveštaja"
          className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
        >
          {[
            ["prodaja", "Porudžbine i prodaja"],
            ["zalihe", "Zalihe"],
            ["roba-u-dolasku", "Roba u dolasku"],
            ["reklamacije", "Reklamacije"],
          ].map(([id, label], index) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-xl border border-border/60 bg-surface px-4 py-3 text-sm text-ink-700 transition hover:border-walnut/40 hover:text-walnut"
            >
              <span className="mr-2 text-xs text-ink-500">0{index + 1}</span>
              {label}
            </a>
          ))}
        </nav>

        <ReportSection
          id="prodaja"
          number="01"
          title="Porudžbine i prodaja (Fiskalizovano)"
          description="Prikaz koristi samo izdate fiskalne račune i refundacije sa datumom izdavanja u izabranom periodu."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Fiskalizovane porudžbine"
              value={formatInteger(fiscalOrderGroups.length)}
              hint={`${formatInteger(fiscalSales._count.id)} izdatih računa`}
            />
            <StatCard label="Bruto prodaja" value={formatRsd(saleGross)} />
            <StatCard
              label="Refundacije"
              value={formatRsd(refundGross)}
              hint={`${formatInteger(fiscalRefunds._count.id)} dokumenata`}
              tone={refundGross > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Neto fiskalizovano"
              value={formatRsd(netFiscalized)}
              tone={netFiscalized >= 0 ? "success" : "danger"}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Prosečna cena artikla" value={formatRsd(averageMerchandisePrice)} hint="Bruto roba / prodati komadi; bez dostave i uslužnog dela montaže" />
            <StatCard label="Prosečan račun" value={formatRsd(averageBasket)} hint={`${itemsPerBasket.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} artikala po računu`} />
            <StatCard label="Ponovljeni kupci" value={formatInteger(salesKpis.repeat_customers)} hint={`${formatPercent(repeatCustomerShare)} identifikovanih kupaca`} />
            <StatCard label="Prosečan rok isporuke" value={`${salesKpis.average_delivery_days.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })} dana`} hint="Order.createdAt → prva potvrđena Shipment.deliveredAt" />
            <StatCard label="Dnevni maksimum" value={formatRsd(salesKpis.daily_max)} hint={salesKpis.daily_max_date ? formatIsoDate(salesKpis.daily_max_date) : "Bez prodaje"} />
            <StatCard label="Mesečni maksimum" value={formatRsd(salesKpis.monthly_max)} hint={salesKpis.monthly_max_date ? formatMonth(salesKpis.monthly_max_date) : "Bez prodaje"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Top artikli po fiskalizovanoj količini</CardTitle>
              <DataTable
                columns={[
                  { key: "sku", label: "SKU" },
                  { key: "name", label: "Naziv" },
                  { key: "qty", label: "Komada", align: "right" },
                  { key: "revenue", label: "Promet", align: "right" },
                ]}
                rows={topItems.map((item) => ({
                  id: `${item.sku}-${item.short_name}`,
                  cells: {
                    sku: <span className="font-mono text-xs">{item.sku}</span>,
                    name: item.short_name,
                    qty: formatInteger(item.qty),
                    revenue: formatRsd(item.revenue),
                  },
                }))}
                empty="Nema fiskalizovane prodaje u periodu."
              />
            </Card>

            <Card>
              <CardTitle>Top kategorije po fiskalizovanom prometu</CardTitle>
              <DataTable
                columns={[
                  { key: "category", label: "Kategorija" },
                  { key: "qty", label: "Komada", align: "right" },
                  { key: "revenue", label: "Promet", align: "right" },
                ]}
                rows={topCategories.map((item, index) => ({
                  id: `${item.category_name ?? "bez-kategorije"}-${index}`,
                  cells: {
                    category: item.category_name ?? "Bez kategorije",
                    qty: formatInteger(item.qty),
                    revenue: formatRsd(item.revenue),
                  },
                }))}
                empty="Nema fiskalizovane prodaje po kategorijama u periodu."
              />
            </Card>
          </div>
        </ReportSection>

        <ReportSection
          id="zalihe"
          number="02"
          title="Zalihe"
          description="Trenutno stanje i prosečno završno stanje svakog kalendarskog dana u izabranom periodu, uključujući dane sa nulom."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Komada na stanju" value={formatInteger(stockSummary.total_qty)} />
            <StatCard label="SKU-ova na stanju" value={formatInteger(stockSummary.sku_count)} />
            <StatCard label="COGS vrednost" value={formatRsd(stockSummary.stock_value)} />
            <StatCard label="Procenjena zapremina" value={formatVolume(stockSummary.total_volume)} />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Prosečne zalihe" value={`${inventorySummary.averageQty.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} kom`} hint={formatRsd(inventorySummary.averageValue)} />
            <StatCard label="KOZ perioda" value={totalTurnover.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 3 })} hint={`${formatRsd(inventorySummary.cogs)} neto COGS / prosečne zalihe`} />
          </div>

          <Card>
            <CardTitle description="Vrednost je obračunata po trenutnom COGS-u, a m³ prema evidentiranim dimenzijama artikla.">
              Stanje po magacinu
            </CardTitle>
            <DataTable
              columns={[
                { key: "warehouse", label: "Magacin" },
                { key: "skus", label: "SKU-ova", align: "right" },
                { key: "qty", label: "Komada", align: "right" },
                { key: "value", label: "COGS vrednost", align: "right" },
                { key: "volume", label: "Zapremina", align: "right" },
              ]}
              rows={warehouseStockRows.map((row) => ({
                id: row.id,
                cells: {
                  warehouse: (
                    <div>
                      <span className="font-medium text-ink-900">{row.name}</span>
                      <span className="ml-2 font-mono text-xs text-ink-500">{row.code}</span>
                    </div>
                  ),
                  skus: formatInteger(row.sku_count),
                  qty: formatInteger(row.total_qty),
                  value: formatRsd(row.stock_value),
                  volume: formatVolume(row.total_volume),
                },
              }))}
              empty="Nema aktivnih magacina."
            />
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <TurnoverTable title="KOZ po dobavljaču" rows={turnoverBySupplier} />
            <TurnoverTable title="KOZ po magacinu" rows={turnoverByWarehouse} />
            <TurnoverTable title="KOZ po statusu artikla" rows={turnoverByStatus} />
            <TurnoverTable title="Top 10 artikala po KOZ-u" rows={turnoverByProduct.slice(0, 10)} />
            <TurnoverTable title="Bottom 10 artikala po KOZ-u" rows={[...turnoverByProduct].sort((left, right) => left.turnover - right.turnover).slice(0, 10)} />
          </div>
        </ReportSection>

        <ReportSection
          id="roba-u-dolasku"
          number="03"
          title="Roba u dolasku"
          description="Aktivne poslate i potvrđene porudžbenice čiji je planirani datum dolaska u izabranom periodu. Ako rok nije unet, koristi se datum porudžbine ili kreiranja."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Porudžbenice" value={formatInteger(incomingSummary.order_count)} />
            <StatCard label="Preostalo komada" value={formatInteger(incomingSummary.remaining_qty)} />
            <StatCard label="Vrednost u RSD" value={formatRsd(incomingSummary.value_rsd)} />
            <StatCard label="Zapremina u dolasku" value={formatVolume(incomingSummary.total_volume)} />
          </div>

          <Card>
            <CardTitle>Po dobavljaču i statusu</CardTitle>
            <DataTable
              columns={[
                { key: "supplier", label: "Dobavljač" },
                { key: "status", label: "Status" },
                { key: "articleStatus", label: "Status artikla" },
                { key: "orders", label: "Porudžbenice", align: "right" },
                { key: "qty", label: "Preostalo komada", align: "right" },
                { key: "value", label: "Vrednost", align: "right" },
                { key: "volume", label: "Zapremina", align: "right" },
              ]}
              rows={incomingBreakdown.map((row, index) => ({
                id: `${row.supplier}-${row.status}-${index}`,
                cells: {
                  supplier: row.supplier,
                  status: row.status === "CONFIRMED" ? "Potvrđeno" : "Poslato",
                  articleStatus: row.article_status,
                  orders: formatInteger(row.order_count),
                  qty: formatInteger(row.remaining_qty),
                  value: formatRsd(row.value_rsd),
                  volume: formatVolume(row.total_volume),
                },
              }))}
              empty="Nema robe u dolasku za izabrani period."
            />
          </Card>
        </ReportSection>

        <ReportSection
          id="reklamacije"
          number="04"
          title="Reklamacije"
          description="Reklamacije primljene u izabranom periodu, sa trenutnim statusom i vremenom rešavanja."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Ukupno reklamacija" value={formatInteger(reclamations.length)} />
            <StatCard
              label="Otvorene"
              value={formatInteger(openReclamations)}
              tone={openReclamations > 0 ? "warning" : "default"}
            />
            <StatCard
              label="Prihvaćene"
              value={formatInteger(acceptedReclamations)}
              hint={reclamations.length ? `${formatPercent((acceptedReclamations / reclamations.length) * 100)} svih reklamacija` : "Bez reklamacija"}
            />
            <StatCard
              label="Prosečno rešavanje"
              value={`${averageResolutionDays.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })} dana`}
              hint={`${formatPercent(reclamationShare)} reklamiranih porudžbina prema fiskalizovanim u periodu`}
            />
            <StatCard label="Reklamirana količina" value={formatInteger(reclamationQuantity)} hint={`${reclamations.length} zahteva`} />
            <StatCard label="Prosečan odgovor" value={`${averageResponseDays.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })} dana`} hint={`${responseDurations.length} odgovorenih zahteva`} />
            <StatCard label="Odbijene" value={formatInteger(rejectedReclamations)} hint={reclamations.length ? formatPercent((rejectedReclamations / reclamations.length) * 100) : "Bez reklamacija"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardTitle>Po statusu</CardTitle>
              <DataTable
                columns={[
                  { key: "status", label: "Status" },
                  { key: "count", label: "Broj", align: "right" },
                  { key: "share", label: "Udeo", align: "right" },
                ]}
                rows={reclamationsByStatus.map(([status, count]) => ({
                  id: status,
                  cells: {
                    status: RECLAMATION_STATUS_LABELS[status] ?? status,
                    count: formatInteger(count),
                    share: formatPercent((count / reclamations.length) * 100),
                  },
                }))}
                empty="Nema reklamacija u periodu."
              />
            </Card>

            <Card>
              <CardTitle>Najčešće reklamirani SKU-ovi</CardTitle>
              <DataTable
                columns={[
                  { key: "sku", label: "SKU" },
                  { key: "count", label: "Reklamacija", align: "right" },
                ]}
                rows={topReclamationSkus.map(([sku, count]) => ({
                  id: sku,
                  cells: {
                    sku: <span className="font-mono text-xs">{sku}</span>,
                    count: formatInteger(count),
                  },
                }))}
                empty="Nema reklamiranih artikala u periodu."
              />
            </Card>

            <Card>
              <CardTitle>Po zahtevu kupca</CardTitle>
              <DataTable
                columns={[
                  { key: "request", label: "Zahtev" },
                  { key: "count", label: "Broj", align: "right" },
                ]}
                rows={reclamationsByRequest.map(([request, count]) => ({
                  id: request,
                  cells: { request, count: formatInteger(count) },
                }))}
                empty="Nema reklamacija u periodu."
              />
            </Card>

            <Card>
              <CardTitle>Po načinu rešenja</CardTitle>
              <DataTable
                columns={[
                  { key: "resolution", label: "Rešenje" },
                  { key: "count", label: "Broj", align: "right" },
                ]}
                rows={reclamationsByResolution.map(([resolution, count]) => ({
                  id: resolution,
                  cells: { resolution, count: formatInteger(count) },
                }))}
                empty="Nema rešenih reklamacija u periodu."
              />
            </Card>
          </div>
        </ReportSection>
      </div>
    </>
  );
}

function ReportSection({
  id,
  number,
  title,
  description,
  children,
}: {
  id: string;
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
          {number}
        </p>
        <h2 id={`${id}-title`} className="mt-1 font-display text-2xl text-ink-900">
          {title}
        </h2>
        <p className="mt-1 max-w-4xl text-sm text-ink-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function formatInteger(value: number) {
  return value.toLocaleString("sr-Latn-RS");
}

function formatVolume(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} m³`;
}

function formatPercent(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })}%`;
}

function formatIsoDate(value: string) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("sr-Latn-RS", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function TurnoverTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    id: string;
    label: string;
    averageQty: number;
    averageValue: number;
    cogs: number;
    turnover: number;
  }>;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <DataTable
        columns={[
          { key: "label", label: "Grupa" },
          { key: "average", label: "Prosek zaliha", align: "right" },
          { key: "cogs", label: "Neto COGS", align: "right" },
          { key: "turnover", label: "KOZ", align: "right" },
        ]}
        rows={rows.map((row) => ({
          id: row.id,
          cells: {
            label: row.label,
            average: `${row.averageQty.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} · ${formatRsd(row.averageValue)}`,
            cogs: formatRsd(row.cogs),
            turnover: row.turnover.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 3 }),
          },
        }))}
        empty="Nema podataka za izabrani period."
      />
    </Card>
  );
}

function aggregateTurnover(
  rows: InventoryTurnoverRow[],
  keyFor: (row: InventoryTurnoverRow) => string,
  labelFor: (row: InventoryTurnoverRow) => string,
) {
  const grouped = new Map<
    string,
    { id: string; label: string; averageQty: number; averageValue: number; cogs: number; turnover: number }
  >();
  for (const row of rows) {
    const id = keyFor(row);
    const current = grouped.get(id) ?? {
      id,
      label: labelFor(row),
      averageQty: 0,
      averageValue: 0,
      cogs: 0,
      turnover: 0,
    };
    current.averageQty += row.average_qty;
    current.averageValue += row.average_value;
    current.cogs += row.cogs;
    grouped.set(id, current);
  }
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      turnover: row.averageValue ? row.cogs / row.averageValue : 0,
    }))
    .sort((left, right) => right.turnover - left.turnover || left.label.localeCompare(right.label, "sr-Latn"));
}
