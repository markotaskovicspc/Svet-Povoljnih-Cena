import Link from "next/link";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { formatRsd } from "@/lib/format";
import { resolveReportPeriod, type ReportPeriod } from "@/lib/admin/report-period";
import {
  cleanDashboardContext,
  dashboardContextFromSavedColumns,
  hasDashboardContext,
  resolveDashboardFilters,
  type DashboardFilterContext,
} from "@/lib/admin/dashboard-context";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle, StatCard } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { DashboardFilters } from "@/components/admin/dashboard-filters";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Kontrolna tabla",
  robots: { index: false, follow: false },
};

type DashboardParams = Partial<DashboardFilterContext> & { forbidden?: string };

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

function periodFilter(period: ReportPeriod) {
  return { gte: period.start, lt: period.endExclusive };
}

function formatVolume(value: number) {
  return `${value.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 2 })} m³`;
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<DashboardParams>;
}) {
  const admin = await requireAdminAction();
  const sp = await searchParams;
  const explicitContext = cleanDashboardContext(sp);
  const hasExplicitContext = hasDashboardContext(sp);

  const [warehouses, defaultView] = await Promise.all([
    db.warehouse.findMany({
      where: { active: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    hasExplicitContext
      ? Promise.resolve(null)
      : db.adminSavedView.findFirst({
          where: {
            adminUserId: admin.id,
            module: "dashboard",
            isDefault: true,
          },
          orderBy: { updatedAt: "desc" },
          select: { columns: true },
        }),
  ]);

  const savedContext = dashboardContextFromSavedColumns(defaultView?.columns);
  const now = new Date();
  const resolved = resolveDashboardFilters(
    hasExplicitContext ? explicitContext : savedContext,
    now,
  );
  const warehouseId = warehouses.some(
    (warehouse) => warehouse.id === resolved.context.warehouseId,
  )
    ? resolved.context.warehouseId
    : "";
  const context: DashboardFilterContext = {
    ...resolved.context,
    warehouseId,
  };
  const {
    orders: ordersPeriod,
    fiscal: fiscalPeriod,
    reclamations: reclamationsPeriod,
    topProducts: topProductsPeriod,
  } = resolved.periods;
  const todayPeriod = resolveReportPeriod({ range: "today" }, now);
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === warehouseId);
  const warehouseLabel = selectedWarehouse?.name ?? "Svi magacini";

  const orderWarehouseWhere: Prisma.OrderWhereInput = warehouseId
    ? { items: { some: { warehouseId } } }
    : {};
  const reclamationWarehouseWhere: Prisma.ReclamationWhereInput = warehouseId
    ? { warehouseId }
    : {};
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

  const [
    ordersTodaySummary,
    ordersInPeriodSummary,
    fiscalRows,
    reclamationCount,
    topProducts,
    warehouseStockRows,
    incomingRows,
    visitRows,
    lowStock,
  ] = await Promise.all([
    db.order.aggregate({
      where: {
        createdAt: periodFilter(todayPeriod),
        ...orderWarehouseWhere,
      },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.order.aggregate({
      where: {
        createdAt: periodFilter(ordersPeriod),
        ...orderWarehouseWhere,
      },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.$queryRaw<FiscalTurnoverSummary[]>(Prisma.sql`
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
    `),
    db.reclamation.count({
      where: {
        createdAt: periodFilter(reclamationsPeriod),
        ...reclamationWarehouseWhere,
      },
    }),
    db.$queryRaw<DashboardTopProduct[]>(Prisma.sql`
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
          * COALESCE(
            p."unitPackWidthCm"
            * p."unitPackDepthCm"
            * p."unitPackHeightCm"
            / 1000000,
            0
          )
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
          WHERE type = 'PAGE_VIEW'
            AND "occurredAt" >= ${new Date(now.getTime() - 300_000)})::int AS active_now,
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
        ON w.id = ws."warehouseId" AND w.active = true ${stockWarehouseSql}
      WHERE p."isActive" = true
      GROUP BY p.id, p.sku, p.name, p."incomingStock"
      HAVING COALESCE(SUM(CASE WHEN w.id IS NOT NULL THEN ws.qty ELSE 0 END), 0) <= 2
      ORDER BY qty ASC, p.name ASC
      LIMIT 8
    `),
  ]);

  const fiscal = fiscalRows[0] ?? { today_net: 0, period_net: 0 };
  const ordersToday = ordersTodaySummary._count._all;
  const ordersTodayAmount = Number(ordersTodaySummary._sum.total ?? 0);
  const ordersInPeriod = ordersInPeriodSummary._count._all;
  const ordersInPeriodAmount = Number(ordersInPeriodSummary._sum.total ?? 0);
  const incoming = incomingRows[0] ?? {
    order_count: 0,
    remaining_qty: 0,
    value_rsd: 0,
    total_volume: 0,
  };
  const visits = visitRows[0] ?? {
    active_now: 0,
    today: 0,
    daily_average_30d: 0,
  };
  const totalStock = warehouseStockRows.reduce(
    (total, row) => ({
      total_qty: total.total_qty + row.total_qty,
      stock_value: total.stock_value + row.stock_value,
      total_volume: total.total_volume + row.total_volume,
    }),
    { total_qty: 0, stock_value: 0, total_volume: 0 },
  );
  const visibleWarehouseStock = warehouseId
    ? warehouseStockRows.filter((row) => row.id === warehouseId)
    : warehouseStockRows;
  const visiblePallets = visibleWarehouseStock.reduce(
    (total, row) => ({
      occupied: total.occupied + row.occupied_pallet_places,
      missingSkuCount: total.missingSkuCount + row.missing_pallet_sku_count,
    }),
    { occupied: 0, missingSkuCount: 0 },
  );
  const exportWarehouse = warehouseId
    ? `&warehouseId=${encodeURIComponent(warehouseId)}`
    : "";
  const orderExport = `/api/admin/erp/prodajni-nalozi/export?from=${context.ordersFrom}&to=${context.ordersTo}${exportWarehouse}`;
  const fiscalExport = `/api/admin/erp/prodajni-nalozi/export?from=${context.fiscalFrom}&to=${context.fiscalTo}&dateField=fiscal-issued-at&fiscalStatus=issued${exportWarehouse}`;

  return (
    <>
      <PageHeader
        title="Kontrolna tabla"
        description="Dnevni pregled, sačuvani poslovni periodi i jedinstven magacinski kontekst."
      />
      <div className="space-y-8 px-8 py-6">
        {sp.forbidden ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-700">
            Nemate ovlašćenja za tu sekciju.
          </div>
        ) : null}

        <DashboardFilters context={context} warehouses={warehouses} />

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Link href={orderExport} className="rounded-lg border border-border px-3 py-2 text-sm text-ink-700">
              XLSX porudžbine
            </Link>
            <Link href={fiscalExport} className="rounded-lg border border-border px-3 py-2 text-sm text-ink-700">
              XLSX fiskalizovane porudžbine
            </Link>
          </div>
          <p className="text-xs text-ink-500">
            Fiskalizovani XLSX prati izdate prodajne dokumente; refundacije umanjuju neto kartice, ali nisu zasebni redovi izvoza porudžbina.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Porudžbine danas" value={String(ordersToday)} hint={`${formatRsd(ordersTodayAmount)} · ${warehouseLabel}`} />
          <StatCard label="Porudžbine u periodu" value={String(ordersInPeriod)} hint={`${formatRsd(ordersInPeriodAmount)} · ${ordersPeriod.label} · ${warehouseLabel}`} />
          <StatCard label="Promet danas (neto fiskalizovano)" value={formatRsd(fiscal.today_net)} hint={warehouseLabel} />
          <StatCard label="Promet u periodu (neto fiskalizovano)" value={formatRsd(fiscal.period_net)} hint={`${fiscalPeriod.label} · ${warehouseLabel}`} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Reklamacije u periodu" value={String(reclamationCount)} hint={`${reclamationsPeriod.label} · ${warehouseLabel}`} tone={reclamationCount > 0 ? "warning" : "default"} />
          <StatCard label="Ukupne zalihe po COGS-u" value={formatRsd(totalStock.stock_value)} hint={`${totalStock.total_qty} kom · ${formatVolume(totalStock.total_volume)} · svi aktivni magacini`} />
          <StatCard
            label="Zauzeta paletna mesta"
            value={visiblePallets.occupied.toLocaleString("sr-Latn-RS")}
            hint={`${visiblePallets.missingSkuCount} SKU bez podatka kom/paleta · ${warehouseLabel}`}
            tone={visiblePallets.missingSkuCount > 0 ? "warning" : "default"}
          />
          <StatCard label="Roba u dolasku" value={formatRsd(incoming.value_rsd)} hint={`${incoming.remaining_qty} kom · ${formatVolume(incoming.total_volume)} · ${warehouseLabel}`} />
        </div>

        <Card>
          <CardTitle
            description={`${warehouseId ? `Prikazan je magacin ${warehouseLabel}.` : "Prikazani su svi aktivni magacini."} Zapremina = stanje × Š × D × V pakovanja pojedinačnog artikla ÷ 1.000.000. Paletna mesta = zbir zaokruženog naviše odnosa stanje ÷ komada na paleti, zasebno po SKU-u.`}
          >
            Zalihe za magacin
          </CardTitle>
          <DataTable
            columns={[
              { key: "warehouse", label: "Magacin" },
              { key: "skus", label: "SKU-ova", align: "right" },
              { key: "qty", label: "Komada", align: "right" },
              { key: "value", label: "COGS vrednost", align: "right" },
              { key: "volume", label: "Zapremina", align: "right" },
              { key: "pallets", label: "Paletna mesta", align: "right" },
              { key: "missingPallets", label: "SKU bez kom/paleta", align: "right" },
            ]}
            rows={visibleWarehouseStock.map((row) => ({
              id: row.id,
              cells: {
                warehouse: `${row.name} (${row.code})`,
                skus: row.sku_count,
                qty: row.total_qty,
                value: formatRsd(row.stock_value),
                volume: formatVolume(row.total_volume),
                pallets: row.occupied_pallet_places.toLocaleString("sr-Latn-RS"),
                missingPallets: row.missing_pallet_sku_count,
              },
            }))}
            empty="Nema aktivnih magacina."
          />
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard label="Trenutni broj poseta" value={String(visits.active_now)} hint="Jedinstvene consented sesije u poslednjih 5 minuta" />
          <StatCard label="Današnji broj poseta" value={String(visits.today)} hint="Jedinstvene consented sesije danas" />
          <StatCard label="Prosečan dnevni broj poseta" value={visits.daily_average_30d.toLocaleString("sr-Latn-RS", { maximumFractionDigits: 1 })} hint="Poslednjih 30 kalendarskih dana, uključujući dane bez poseta" />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card>
            <CardTitle description={`${topProductsPeriod.label} · ${warehouseLabel}`}>
              Top proizvodi
            </CardTitle>
            <DataTable
              columns={[
                { key: "sku", label: "SKU" },
                { key: "name", label: "Naziv" },
                { key: "qty", label: "Komada", align: "right" },
              ]}
              rows={topProducts.map((product) => ({
                id: `${product.sku}-${product.name}`,
                cells: {
                  sku: <span className="font-mono text-xs">{product.sku}</span>,
                  name: product.name,
                  qty: product.qty,
                },
              }))}
              empty="Nema neotkazanih porudžbina u periodu."
            />
          </Card>

          <Card>
            <CardTitle description={`Aktivni artikli sa stanjem ≤ 2 · ${warehouseLabel}`}>
              Niske zalihe
            </CardTitle>
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
      </div>
    </>
  );
}
