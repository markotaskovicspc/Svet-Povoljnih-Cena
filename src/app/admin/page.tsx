import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { resolveReportPeriod, type ReportPeriod } from "@/lib/admin/report-period";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import {
  DashboardFilters,
  type DashboardFilterContext,
} from "@/components/admin/dashboard-filters";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kontrolna tabla",
  robots: { index: false, follow: false },
};

type DashboardParams = Partial<DashboardFilterContext> & { forbidden?: string };

type StockSummary = {
  total_qty: number;
  sku_count: number;
  stock_value: number;
  total_volume: number;
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
  revenue: number;
};

function dashboardPeriod(from?: string, to?: string, now = new Date()) {
  if (from && to) {
    const custom = resolveReportPeriod({ range: "custom", from, to }, now);
    if (custom.preset === "custom") return custom;
  }
  return resolveReportPeriod({ range: "30d" }, now);
}

function periodFilter(period: ReportPeriod) {
  return { gte: period.start, lt: period.endExclusive };
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardParams>;
}) {
  await requireAdminAction();
  const sp = await searchParams;
  const now = new Date();
  const ordersPeriod = dashboardPeriod(sp.ordersFrom, sp.ordersTo, now);
  const fiscalPeriod = dashboardPeriod(sp.fiscalFrom, sp.fiscalTo, now);
  const reclamationsPeriod = dashboardPeriod(
    sp.reclamationsFrom,
    sp.reclamationsTo,
    now,
  );
  const topProductsPeriod = dashboardPeriod(
    sp.topProductsFrom,
    sp.topProductsTo,
    now,
  );
  const todayPeriod = resolveReportPeriod({ range: "today" }, now);
  const warehouses = await db.warehouse.findMany({
    where: { active: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true },
  });
  const warehouseId = warehouses.some((warehouse) => warehouse.id === sp.warehouseId)
    ? sp.warehouseId!
    : "";
  const context: DashboardFilterContext = {
    warehouseId,
    ordersFrom: ordersPeriod.fromInput,
    ordersTo: ordersPeriod.toInput,
    fiscalFrom: fiscalPeriod.fromInput,
    fiscalTo: fiscalPeriod.toInput,
    reclamationsFrom: reclamationsPeriod.fromInput,
    reclamationsTo: reclamationsPeriod.toInput,
    topProductsFrom: topProductsPeriod.fromInput,
    topProductsTo: topProductsPeriod.toInput,
  };
  const orderWarehouseWhere = warehouseId
    ? { items: { some: { warehouseId } } }
    : {};
  const fiscalWarehouseWhere = warehouseId ? { warehouseId } : {};
  const reclamationWarehouseWhere = warehouseId ? { warehouseId } : {};
  const warehouseSql = warehouseId
    ? Prisma.sql`AND w.id = ${warehouseId}`
    : Prisma.empty;
  const purchaseWarehouseSql = warehouseId
    ? Prisma.sql`AND po."receivingWarehouseId" = ${warehouseId}`
    : Prisma.empty;
  const fiscalWarehouseSql = warehouseId
    ? Prisma.sql`AND f."warehouseId" = ${warehouseId}`
    : Prisma.empty;

  const [
    orderAggregate,
    fiscalAggregate,
    reclamationCount,
    openOrders,
    openReclamations,
    pendingComments,
    topProducts,
    stockRows,
    incomingRows,
    visitRows,
    lowStock,
    lastImports,
  ] = await Promise.all([
    db.order.aggregate({
      where: {
        createdAt: periodFilter(ordersPeriod),
        status: { not: "OTKAZANO" },
        ...orderWarehouseWhere,
      },
      _count: { id: true },
      _sum: { total: true },
    }),
    db.fiscalDocument.aggregate({
      where: {
        kind: "SALE",
        status: "ISSUED",
        issuedAt: periodFilter(fiscalPeriod),
        ...fiscalWarehouseWhere,
      },
      _count: { id: true },
      _sum: { totalGross: true },
    }),
    db.reclamation.count({
      where: {
        createdAt: periodFilter(reclamationsPeriod),
        ...reclamationWarehouseWhere,
      },
    }),
    db.order.count({
      where: {
        status: { in: ["KREIRANO", "POTVRDJENO", "U_PRIPREMI"] },
        ...orderWarehouseWhere,
      },
    }),
    db.reclamation.count({
      where: {
        status: { in: ["PRIMLJENO", "U_OBRADI"] },
        ...reclamationWarehouseWhere,
      },
    }),
    db.comment.count({ where: { reviewed: false } }),
    db.$queryRaw<DashboardTopProduct[]>(Prisma.sql`
      SELECT
        l.sku,
        l."shortName" AS name,
        COALESCE(SUM(l.qty), 0)::int AS qty,
        COALESCE(SUM(GREATEST(l."totalGross" - l."serviceGross", 0)), 0)::double precision AS revenue
      FROM "FiscalDocumentLine" l
      JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
      WHERE f.kind = 'SALE'
        AND f.status = 'ISSUED'
        AND f."issuedAt" >= ${topProductsPeriod.start}
        AND f."issuedAt" < ${topProductsPeriod.endExclusive}
        AND l."productId" IS NOT NULL
        ${fiscalWarehouseSql}
      GROUP BY l.sku, l."shortName"
      ORDER BY qty DESC, revenue DESC, l.sku ASC
      LIMIT 10
    `),
    db.$queryRaw<StockSummary[]>(Prisma.sql`
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
      WHERE true ${warehouseSql}
    `),
    db.$queryRaw<IncomingSummary[]>(Prisma.sql`
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
      WHERE po.status IN ('SENT', 'CONFIRMED') ${purchaseWarehouseSql}
    `),
    db.$queryRaw<VisitSummary[]>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(
          ((${now}::timestamptz AT TIME ZONE 'Europe/Belgrade')::date - 29),
          (${now}::timestamptz AT TIME ZONE 'Europe/Belgrade')::date,
          interval '1 day'
        )::date AS day
      ), daily AS (
        SELECT
          d.day,
          COUNT(DISTINCT COALESCE(a."sessionId", a."anonymousId"))::double precision AS visits
        FROM days d
        LEFT JOIN "AnalyticsEvent" a
          ON a.type = 'PAGE_VIEW'
          AND a."occurredAt" >= d.day::timestamp AT TIME ZONE 'Europe/Belgrade'
          AND a."occurredAt" < (d.day + 1)::timestamp AT TIME ZONE 'Europe/Belgrade'
        GROUP BY d.day
      )
      SELECT
        (SELECT COUNT(DISTINCT COALESCE("sessionId", "anonymousId"))
          FROM "AnalyticsEvent"
          WHERE type = 'PAGE_VIEW' AND "occurredAt" >= ${new Date(now.getTime() - 300_000)})::int AS active_now,
        (SELECT COUNT(DISTINCT COALESCE("sessionId", "anonymousId"))
          FROM "AnalyticsEvent"
          WHERE type = 'PAGE_VIEW'
            AND "occurredAt" >= ${todayPeriod.start}
            AND "occurredAt" < ${todayPeriod.endExclusive})::int AS today,
        COALESCE((SELECT AVG(visits) FROM daily), 0)::double precision AS daily_average_30d
    `),
    db.$queryRaw<LowStockRow[]>(Prisma.sql`
      SELECT
        p.id,
        p.sku,
        p.name,
        COALESCE(SUM(CASE WHEN w.id IS NOT NULL THEN ws.qty ELSE 0 END), 0)::int AS qty,
        p."incomingStock"::int AS incoming_stock
      FROM "Product" p
      LEFT JOIN "WarehouseStock" ws ON ws."productId" = p.id
      LEFT JOIN "Warehouse" w
        ON w.id = ws."warehouseId" AND w.active = true ${warehouseSql}
      WHERE p."isActive" = true
      GROUP BY p.id, p.sku, p.name, p."incomingStock"
      HAVING COALESCE(SUM(CASE WHEN w.id IS NOT NULL THEN ws.qty ELSE 0 END), 0) <= 2
      ORDER BY qty ASC, p.name ASC
      LIMIT 8
    `),
    db.importRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 5,
      include: { supplier: { select: { name: true } } },
    }),
  ]);

  const stock = stockRows[0] ?? { total_qty: 0, sku_count: 0, stock_value: 0, total_volume: 0 };
  const incoming = incomingRows[0] ?? { order_count: 0, remaining_qty: 0, value_rsd: 0, total_volume: 0 };
  const visits = visitRows[0] ?? { active_now: 0, today: 0, daily_average_30d: 0 };
  const exportWarehouse = warehouseId ? `&warehouseId=${encodeURIComponent(warehouseId)}` : "";
  const orderExport = `/api/admin/erp/prodajni-nalozi/export?from=${context.ordersFrom}&to=${context.ordersTo}${exportWarehouse}`;
  const fiscalExport = `/api/admin/erp/prodajni-nalozi/export?from=${context.fiscalFrom}&to=${context.fiscalTo}&dateField=fiscal-issued-at&fiscalStatus=issued${exportWarehouse}`;

  return (
    <>
      <PageHeader
        title="Kontrolna tabla"
        description="Odvojeni poslovni periodi, magacinski kontekst i fiskalizovani promet."
      />
      <div className="space-y-8 px-8 py-6">
        {sp.forbidden ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-700">
            Nemate ovlašćenja za tu sekciju.
          </div>
        ) : null}

        <DashboardFilters context={context} warehouses={warehouses} />

        <div className="flex flex-wrap gap-2">
          <Link href={orderExport} className="rounded-lg border border-border px-3 py-2 text-sm text-ink-700">
            XLSX porudžbine
          </Link>
          <Link href={fiscalExport} className="rounded-lg border border-border px-3 py-2 text-sm text-ink-700">
            XLSX fiskalizovani nalozi
          </Link>
          <Link href="/admin/erp/reklamacije-dnevnik" className="rounded-lg border border-border px-3 py-2 text-sm text-ink-700">
            XLSX reklamacije
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Porudžbine" value={String(orderAggregate._count.id)} hint={`${formatRsd(num(orderAggregate._sum.total))} · ${ordersPeriod.label}`} />
          <StatCard label="Fiskalizovani promet" value={formatRsd(num(fiscalAggregate._sum.totalGross))} hint={`${fiscalAggregate._count.id} računa · ${fiscalPeriod.label}`} />
          <StatCard label="Reklamacije" value={String(reclamationCount)} hint={reclamationsPeriod.label} tone={reclamationCount > 0 ? "warning" : "default"} />
          <StatCard label="Otvorene operacije" value={`${openOrders} / ${openReclamations}`} hint={`Nalozi / reklamacije · komentari ${pendingComments}`} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Zalihe po COGS-u" value={formatRsd(stock.stock_value)} hint={`${stock.total_qty} kom · ${stock.total_volume.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} m³`} />
          <StatCard label="Roba u dolasku" value={formatRsd(incoming.value_rsd)} hint={`${incoming.remaining_qty} kom · ${incoming.total_volume.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} m³`} />
          <StatCard label="Trenutne posete" value={String(visits.active_now)} hint="Jedinstvene aktivne sesije u poslednjih 5 min" />
          <StatCard label="Današnje posete" value={String(visits.today)} hint={`30-dnevni dnevni prosek ${visits.daily_average_30d.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })}`} />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle description={topProductsPeriod.label}>Top fiskalizovani proizvodi</CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "qty", label: "Komada", align: "right" },
                { key: "revenue", label: "Promet", align: "right" },
              ]}
              rows={topProducts.map((product) => ({
                id: `${product.sku}-${product.name}`,
                cells: {
                  sku: <span className="font-mono text-xs">{product.sku}</span>,
                  name: product.name,
                  qty: product.qty,
                  revenue: formatRsd(product.revenue),
                },
              }))}
              empty="Nema fiskalizovane prodaje u periodu."
            />
          </Card>

          <Card>
            <CardTitle description="Aktivni artikli sa stanjem ≤ 2 u izabranom magacinskom kontekstu">Niske zalihe</CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "stock", label: "Stanje", align: "right" },
                { key: "incoming", label: "Ulazi", align: "right" },
              ]}
              rows={lowStock.map((product) => ({
                id: product.id,
                cells: {
                  sku: <span className="font-mono text-xs">{product.sku}</span>,
                  name: product.name,
                  stock: <span className={product.qty === 0 ? "text-danger" : ""}>{product.qty}</span>,
                  incoming: product.incoming_stock,
                },
              }))}
              empty="Nema artikala sa niskim zalihama."
            />
          </Card>
        </div>

        <Card>
          <CardTitle description="Poslednjih 5 pokretanja XML feed importera">Status feed-a</CardTitle>
          <DataTable
            columns={[
              { key: "supplier", label: "Dobavljač" },
              { key: "started", label: "Pokrenuto" },
              { key: "status", label: "Status" },
              { key: "ok", label: "OK", align: "right" },
              { key: "fail", label: "Grešaka", align: "right" },
            ]}
            rows={lastImports.map((run) => ({
              id: run.id,
              cells: {
                supplier: run.supplier?.name ?? "—",
                started: new Intl.DateTimeFormat("sr-Latn-RS", { dateStyle: "short", timeStyle: "short" }).format(run.startedAt),
                status: run.status,
                ok: run.recordsOk,
                fail: run.recordsFail,
              },
            }))}
            empty="Importer još nije pokrenut."
          />
        </Card>
      </div>
    </>
  );
}
